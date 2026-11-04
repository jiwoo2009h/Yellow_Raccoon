"""컴퓨터 비전으로 식물 사진에서 생육 지표를 뽑아내는 모듈.

계획서 3-나-2) 의 순서를 그대로 따릅니다.
  1. 사진 불러오기 (휴대폰 사진의 회전 정보 반영)
  2. 크기 맞추기 + 노이즈 제거 (전처리)
  3. RGB(BGR) -> HSV 변환 후 초록색 범위로 Thresholding
  4. Morphological Operation (Opening -> Closing)
  5. Contour 검출 후 식물 영역 선택
  6. 경계 상자로 높이·폭, 픽셀 수로 투영 면적 계산
  7. 기준물(자)로 픽셀 -> cm 환산 (환산은 저장된 보정값으로 growth.py 에서 수행)
"""

from dataclasses import dataclass, field
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps

# 모든 사진을 긴 변 기준 이 크기로 맞춥니다.
# 같은 위치에서 찍으면 사진마다 '1픽셀 = 같은 실제 길이'가 되도록 하기 위함입니다.
TARGET_LONG_SIDE = 1280


class PlantNotFoundError(ValueError):
    """사진에서 식물(초록색 영역)을 찾지 못했을 때."""


@dataclass
class AnalysisResult:
    height_px: int
    width_px: int
    area_px: int
    bbox: tuple  # (x, y, w, h)
    hue: float
    sat: float
    val: float
    img_w: int
    img_h: int
    image: np.ndarray = field(repr=False)
    mask: np.ndarray = field(repr=False)
    overlay: np.ndarray = field(repr=False)
    warnings: list = field(default_factory=list)

    def metrics(self):
        x, y, w, h = self.bbox
        return {
            "height_px": self.height_px,
            "width_px": self.width_px,
            "area_px": self.area_px,
            "bbox": [x, y, w, h],
            "hue": round(self.hue, 2),
            "sat": round(self.sat, 2),
            "val": round(self.val, 2),
            "img_w": self.img_w,
            "img_h": self.img_h,
            "warnings": self.warnings,
        }


def load_image(data: bytes) -> np.ndarray:
    """업로드된 바이트를 OpenCV(BGR) 이미지로 바꿉니다. 휴대폰 사진의 회전(EXIF)도 반영합니다."""
    try:
        pil = Image.open(BytesIO(data))
        pil = ImageOps.exif_transpose(pil)
        pil = pil.convert("RGB")
    except Exception as exc:  # Pillow 는 여러 종류의 예외를 던집니다
        raise ValueError("사진을 읽을 수 없어요. JPG 또는 PNG 파일인지 확인해 주세요.") from exc
    return cv2.cvtColor(np.asarray(pil), cv2.COLOR_RGB2BGR)


def normalize_size(image: np.ndarray, long_side: int = TARGET_LONG_SIDE) -> np.ndarray:
    h, w = image.shape[:2]
    scale = long_side / max(h, w)
    if abs(scale - 1) < 1e-3:
        return image
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    return cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=interp)


class PlantAnalyzer:
    def __init__(self, hsv_lower=(30, 40, 35), hsv_upper=(90, 255, 255)):
        self.hsv_lower = np.array(hsv_lower, dtype=np.uint8)
        self.hsv_upper = np.array(hsv_upper, dtype=np.uint8)

    # ---- 2~4단계: 전처리 + HSV Thresholding + 형태학적 연산 ----
    def segment(self, image: np.ndarray) -> np.ndarray:
        blurred = cv2.GaussianBlur(image, (5, 5), 0)
        hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, self.hsv_lower, self.hsv_upper)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)  # 작은 점(잡음) 제거
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)  # 잎 사이 작은 빈틈 메우기
        return mask

    # ---- 5단계: 식물 영역 고르기 ----
    @staticmethod
    def select_plant(mask: np.ndarray):
        """가장 큰 초록 덩어리를 중심으로, 그 근처에 있는 잎 조각들을 함께 식물로 봅니다.

        바질처럼 잎이 떨어져 보이는 경우에도 한 식물로 묶고,
        사진 가장자리에 걸친 옆 화분의 잎은 되도록 빼기 위한 규칙입니다.
        """
        img_h, img_w = mask.shape[:2]
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_piece = img_w * img_h * 0.0005
        pieces = [c for c in contours if cv2.contourArea(c) >= min_piece]
        if not pieces:
            return [], None
        pieces.sort(key=cv2.contourArea, reverse=True)
        main = pieces[0]
        if cv2.contourArea(main) < img_w * img_h * 0.003:
            return [], None

        selected = [main]
        box = list(cv2.boundingRect(main))
        rest = pieces[1:]
        changed = True
        while changed and rest:
            changed = False
            x, y, w, h = box
            margin = 0.25 * max(w, h)
            ex0, ey0, ex1, ey1 = x - margin, y - margin, x + w + margin, y + h + margin
            keep = []
            for c in rest:
                cx, cy, cw, ch = cv2.boundingRect(c)
                overlaps = cx < ex1 and cx + cw > ex0 and cy < ey1 and cy + ch > ey0
                if overlaps:
                    selected.append(c)
                    nx0, ny0 = min(x, cx), min(y, cy)
                    nx1, ny1 = max(x + w, cx + cw), max(y + h, cy + ch)
                    box = [nx0, ny0, nx1 - nx0, ny1 - ny0]
                    x, y, w, h = box
                    changed = True
                else:
                    keep.append(c)
            rest = keep
        return selected, tuple(int(v) for v in box)

    def analyze(self, image: np.ndarray) -> AnalysisResult:
        image = normalize_size(image)
        img_h, img_w = image.shape[:2]
        raw_mask = self.segment(image)
        selected, bbox = self.select_plant(raw_mask)
        if not selected:
            raise PlantNotFoundError(
                "사진에서 식물을 찾지 못했어요. 식물이 잘 보이도록 밝은 곳에서 다시 찍거나, "
                "설정에서 색상(HSV) 범위를 조정해 주세요."
            )

        # 선택한 윤곽선 내부 중 실제로 초록색인 픽셀만 식물로 셉니다 (잎 사이 구멍 제외).
        region = np.zeros_like(raw_mask)
        cv2.drawContours(region, selected, -1, 255, thickness=cv2.FILLED)
        plant_mask = cv2.bitwise_and(raw_mask, region)

        # ---- 6단계: 생육 지표 ----
        x, y, w, h = bbox
        area_px = int(cv2.countNonZero(plant_mask))
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        mean_h, mean_s, mean_v, _ = cv2.mean(hsv, mask=plant_mask)

        warnings = self.quality_warnings(image, hsv, bbox, area_px)
        overlay = self.draw_overlay(image, plant_mask, selected, bbox)
        return AnalysisResult(
            height_px=int(h),
            width_px=int(w),
            area_px=area_px,
            bbox=(int(x), int(y), int(w), int(h)),
            hue=float(mean_h),
            sat=float(mean_s),
            val=float(mean_v),
            img_w=int(img_w),
            img_h=int(img_h),
            image=image,
            mask=plant_mask,
            overlay=overlay,
            warnings=warnings,
        )

    @staticmethod
    def quality_warnings(image, hsv, bbox, area_px):
        """계획서 '모. 영상 분석에서 발생할 수 있는 오차'를 줄이기 위한 촬영 상태 점검."""
        img_h, img_w = image.shape[:2]
        x, y, w, h = bbox
        warnings = []
        edge = 3
        if x <= edge or y <= edge or x + w >= img_w - edge or y + h >= img_h - edge:
            warnings.append("식물이 사진 가장자리에 닿아 있어요. 식물 전체가 나오게 찍으면 더 정확해요.")
        if float(np.mean(hsv[:, :, 2])) < 70:
            warnings.append("사진이 어두워요. 조명을 켜거나 밝은 곳에서 찍어 주세요.")
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        if cv2.Laplacian(gray, cv2.CV_64F).var() < 30:
            warnings.append("사진이 흐릿해요. 초점을 맞추고 흔들리지 않게 찍어 주세요.")
        if area_px > img_w * img_h * 0.6:
            warnings.append("초록색 영역이 너무 넓어요. 배경에 초록색 물건이 있는지 확인해 주세요.")
        return warnings

    @staticmethod
    def draw_overlay(image, plant_mask, contours, bbox):
        """분석 결과 이미지: 배경은 어둡게, 식물 영역은 초록으로 강조, 높이·폭 상자 표시."""
        dim = (image * 0.45).astype(np.uint8)
        tint = np.full_like(image, (90, 200, 60))  # BGR 초록
        plant = cv2.addWeighted(image, 0.55, tint, 0.45, 0)
        out = np.where(plant_mask[..., None] > 0, plant, dim)
        cv2.drawContours(out, contours, -1, (255, 255, 255), 2, lineType=cv2.LINE_AA)
        x, y, w, h = bbox
        cv2.rectangle(out, (x, y), (x + w, y + h), (255, 255, 255), 1, lineType=cv2.LINE_AA)
        return out


def encode_jpeg(image: np.ndarray, quality: int = 88) -> bytes:
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("이미지를 저장하지 못했어요.")
    return buf.tobytes()


def encode_png(mask: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", mask)
    if not ok:
        raise ValueError("마스크를 저장하지 못했어요.")
    return buf.tobytes()
