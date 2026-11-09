"""컴퓨터 비전으로 식물 사진에서 생육 지표를 뽑아내는 모듈.

계획서 3-나-2) 의 순서를 그대로 따릅니다.
  1. 사진 불러오기 (휴대폰 사진의 회전 정보 반영)
  2. 크기 맞추기 + 노이즈 제거 (전처리)
  3. RGB(BGR) -> HSV 변환 후 초록색 범위로 Thresholding
  4. Morphological Operation (Opening -> Closing)
  5. Contour 검출 후 식물 영역 선택
  6. 경계 상자로 높이·폭, 픽셀 수로 투영 면적 계산
  7. 기준물로 픽셀 -> cm 환산
     - 파란 기준 스티커가 사진에 있으면 스티커 한 변의 픽셀 수로 사진마다 자동 환산
     - 없으면 '크기 보정' 화면에서 자로 잡은 보정값 사용 (환산은 growth.py 에서 수행)
  8. 잎 색: 평균 Hue·채도, ExG(초록 지수), 노란 잎 비율
"""

from dataclasses import dataclass, field
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps

# 모든 사진을 긴 변 기준 이 크기로 맞춥니다.
# 같은 위치에서 찍으면 사진마다 '1픽셀 = 같은 실제 길이'가 되도록 하기 위함입니다.
TARGET_LONG_SIDE = 1280

# 파란 기준 스티커 (OpenCV HSV: H 0~179). 초록 식물·갈색 화분과 겹치지 않는 파란색 범위
REF_HSV_LOWER = (95, 120, 50)
REF_HSV_UPPER = (130, 255, 255)
# 노란 잎으로 볼 색 범위 (OpenCV H 15~28 ≈ 30~56°). 상추처럼 초록 범위 하한이 낮으면
# 노란 잎이 식물 면적에도 함께 들어가는데, 그래도 노란 잎 비율은 따로 계산됩니다.
YELLOW_LOWER = (15, 70, 90)
YELLOW_UPPER = (28, 255, 255)


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
    yellow_ratio: float = 0.0
    exg: float = 0.0
    ref: dict = None  # {"cm_per_px", "px_per_cm", "bbox"} 기준 스티커를 찾았을 때

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
            "yellow_ratio": round(self.yellow_ratio, 3),
            "exg": round(self.exg, 4),
            "ref_cm_per_px": self.ref["cm_per_px"] if self.ref else None,
            "ref_bbox": self.ref["bbox"] if self.ref else None,
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
    def __init__(self, hsv_lower=(30, 40, 35), hsv_upper=(90, 255, 255), sticker_cm=None):
        self.hsv_lower = np.array(hsv_lower, dtype=np.uint8)
        self.hsv_upper = np.array(hsv_upper, dtype=np.uint8)
        # 파란 기준 스티커 한 변의 실제 길이(cm). None/0 이면 스티커를 찾지 않습니다.
        self.sticker_cm = sticker_cm if sticker_cm and sticker_cm > 0 else None

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

        yellow_ratio = self.yellow_ratio(hsv, plant_mask, selected)
        exg = self.excess_green(image, plant_mask)
        ref = self.find_reference(hsv)

        warnings = self.quality_warnings(image, hsv, bbox, area_px)
        overlay = self.draw_overlay(image, plant_mask, selected, bbox, ref)
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
            yellow_ratio=yellow_ratio,
            exg=exg,
            ref=ref,
        )

    # ---- 8단계: 잎 색 지표 ----
    def yellow_ratio(self, hsv, plant_mask, contours):
        """식물 윤곽(볼록 껍질) 안에서 노란 픽셀의 비율(%). 노랗게 변한 잎은 초록 범위에서 빠지므로 따로 셉니다."""
        hull = cv2.convexHull(np.vstack(contours))
        region = np.zeros(plant_mask.shape, np.uint8)
        cv2.fillConvexPoly(region, hull, 255)
        yellow = cv2.inRange(hsv, np.array(YELLOW_LOWER, np.uint8), np.array(YELLOW_UPPER, np.uint8))
        yellow = cv2.bitwise_and(yellow, region)
        leaves = cv2.countNonZero(cv2.bitwise_or(yellow, plant_mask))
        return float(cv2.countNonZero(yellow) / leaves * 100) if leaves else 0.0

    @staticmethod
    def excess_green(image, plant_mask):
        """ExG = 2g - r - b (r, g, b 는 R+G+B 로 나눈 색 좌표). 클수록 진한 초록."""
        px = image[plant_mask > 0].astype(np.float64)
        if not len(px):
            return 0.0
        total = px.sum(axis=1)
        total[total == 0] = 1
        b, g, r = (px[:, i] / total for i in range(3))
        return float(np.mean(2 * g - r - b))

    # ---- 7단계: 기준물(파란 스티커)로 크기 환산 ----
    def find_reference(self, hsv):
        """사진에서 정사각형에 가까운 가장 큰 파란 덩어리를 기준 스티커로 봅니다."""
        if not self.sticker_cm:
            return None
        img_h, img_w = hsv.shape[:2]
        mask = cv2.inRange(hsv, np.array(REF_HSV_LOWER, np.uint8), np.array(REF_HSV_UPPER, np.uint8))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best = None
        for c in contours:
            area = cv2.contourArea(c)
            if area < img_w * img_h * 0.0002:
                continue
            (_, _), (rw, rh), _ = cv2.minAreaRect(c)
            if min(rw, rh) < 8 or max(rw, rh) / min(rw, rh) > 1.5:
                continue
            if area / (rw * rh) < 0.75:  # 꽉 찬 사각형이 아니면 스티커가 아님
                continue
            if best is None or area > best[0]:
                best = (area, c, rw, rh)
        if best is None:
            return None
        area, c, rw, rh = best
        side_px = (rw + rh) / 2
        x, y, w, h = cv2.boundingRect(c)
        return {
            "cm_per_px": self.sticker_cm / side_px,
            "px_per_cm": side_px / self.sticker_cm,
            "bbox": [int(x), int(y), int(w), int(h)],
        }

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
    def draw_overlay(image, plant_mask, contours, bbox, ref=None):
        """분석 결과 이미지: 식물 영역은 초록으로 칠하고, 높이·폭 상자(빨강)와 기준 스티커(파랑)를 표시."""
        tint = np.full_like(image, (40, 175, 30))  # BGR 초록
        plant = cv2.addWeighted(image, 0.25, tint, 0.75, 0)
        out = np.where(plant_mask[..., None] > 0, plant, image)
        cv2.drawContours(out, contours, -1, (255, 255, 255), 1, lineType=cv2.LINE_AA)
        x, y, w, h = bbox
        cv2.rectangle(out, (x, y), (x + w, y + h), (40, 40, 230), 3, lineType=cv2.LINE_AA)
        if ref:
            rx, ry, rw, rh = ref["bbox"]
            cv2.rectangle(out, (rx - 4, ry - 4), (rx + rw + 4, ry + rh + 4), (230, 110, 30), 3, lineType=cv2.LINE_AA)
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
