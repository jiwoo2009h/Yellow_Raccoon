"""컴퓨터 비전으로 식물 사진에서 생육 지표를 뽑아내는 모듈.

계획서 3-나-2) 의 순서를 그대로 따릅니다.
  1. 사진 불러오기 (휴대폰 사진의 회전 정보 반영)
  2. 크기 맞추기 + 조명 색 보정(흰 배경판이 회색이 되도록) + 노이즈 제거 (전처리)
  3. RGB(BGR) -> HSV 변환 후 초록색 범위로 Thresholding
     + Lab 색공간의 초록 정도(a*)로 흙·그림자·화분처럼 거의 무채색인 픽셀을 빼고,
       확실한 초록에 '이어진' 가는 줄기·연한 잎·노랗게 변한 잎은 되살립니다 (히스테리시스).
  4. Morphological Operation (Opening -> Closing)
  5. Contour 검출 후 식물 영역 선택 (실제로 가까운 잎 조각만 합쳐 옆 화분이 섞이지 않게)
  6. 경계 상자로 높이·폭, 픽셀 수로 투영 면적, 잎 안쪽 픽셀로 잎 색(Lab 색상각·노란 비율) 계산
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

# Lab a* (빨강 + / 초록 −). 이보다 초록 쪽이어야 식물로 봅니다. 흙·그림자·화분·나무 바닥은 0 근처 또는 +.
GREEN_A_MAX = -6
# 식물 바로 옆에서만 되살리는 연한 잎·줄기: 조금이라도 초록(a* ≤ -2)이고 밝은 픽셀
PALE_A_MAX = -2
PALE_V_MIN = 150
PALE_S_MIN = 12
# 떨어져 보이는 잎 조각을 같은 식물로 합치는 거리: 중심 덩어리 크기(긴 변)의 이 비율 안
MERGE_GAP = 0.08
# 가는 줄기: 초록이 조금 약해도(a* ≤ -3) 채도가 충분하면, 확실한 초록에 이어진 경우만 식물로 (옆에서 찍은 사진)
#   예전에는 a* -5 정도인 아래쪽 줄기가 빠져서 바질 키가 사진마다 30%까지 오르내렸어요.
STEM_A_MAX = -3
STEM_S_MIN = 45
STEM_GROW_STEPS = 200  # 긴 변 1280px 기준 약 15% — 잎 아래에서 흙까지 이어진 줄기 길이 (1단계 = 1px)
# 노랗게 변한 잎: 초록 잎에 이어진 '진한 노랑'만 (Lab 색상각 78~105°, 채도 38 이상, 밝기 45 이상)
#   밝은 나무 바닥도 색상각이 90° 근처라서 채도(바닥 ≈ 23~35)로 구분해요.
YELLOW_HUE = (78, 105)
YELLOW_C_MIN = 38
YELLOW_L_MIN = 45
YELLOW_GROW_STEPS = 80  # 노란 잎 한 장 길이만큼 (줄이면 잎 끝까지 못 따라가요)
# 잎 색 지표: Lab 색상각이 이보다 낮은 잎 픽셀을 '노란 쪽'으로 셉니다 (건강한 잎 ≈ 107~125°)
LEAF_YELLOW_HUE = 98


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
    color: dict = field(default_factory=dict)

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
            "color": self.color,
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


def _ellipse(k):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def _grow(seed: np.ndarray, allowed: np.ndarray, steps: int) -> np.ndarray:
    """seed 에서 시작해 allowed 픽셀을 따라 한 번에 1px 씩 최대 steps 번 넓혀요 (이어진 부분만)."""
    grown = seed
    k3 = _ellipse(3)
    reach = cv2.bitwise_or(allowed, seed)
    for _ in range(steps):
        nxt = cv2.bitwise_and(cv2.dilate(grown, k3), reach)
        if cv2.countNonZero(cv2.bitwise_xor(nxt, grown)) == 0:
            break
        grown = nxt
    return grown


def lab_planes(image: np.ndarray):
    """Lab 의 밝기(0~100), a*, b*, 색상각(°), 채도"""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    light = lab[:, :, 0] * (100 / 255)
    a = lab[:, :, 1] - 128
    b = lab[:, :, 2] - 128
    return light, a, b, np.degrees(np.arctan2(b, a)) % 360, np.hypot(a, b)


def white_balance(image: np.ndarray):
    """흰 배경판처럼 밝고 무채색에 가까운 픽셀이 회색이 되도록 색 균형을 맞춰요.

    아침 햇빛·형광등·흐린 날처럼 조명 색이 바뀌면 같은 잎도 색상 값이 크게 달라져요
    (실제 사진: 푸르게 찍힌 날 Hue 가 20 넘게 올라감). 돌려주는 값: (보정한 사진, 보정 가능 여부)
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    light = lab[:, :, 0]
    a = lab[:, :, 1].astype(np.int16) - 128
    b = lab[:, :, 2].astype(np.int16) - 128
    unclipped = image.max(axis=2) < 250
    enough = image.shape[0] * image.shape[1] * 0.01
    neutral = unclipped & (a * a + b * b < 22 * 22)
    if np.count_nonzero(neutral) < enough:  # 조명 색이 진하면 흰 배경도 색이 꽤 들어가 보여요
        neutral = unclipped & (a * a + b * b < 40 * 40) & (light >= 150)
    if np.count_nonzero(neutral) < enough:
        return image, False  # 흰 배경이 거의 없으면 보정하지 않아요
    ref_mask = neutral & (light >= np.percentile(light[neutral], 90))
    ref = image[ref_mask].reshape(-1, 3).astype(np.float64).mean(axis=0)
    gains = np.clip(ref.mean() / np.maximum(ref, 1), 0.7, 1.4)
    return np.clip(image.astype(np.float32) * gains, 0, 255).astype(np.uint8), True


def leaf_color(balanced: np.ndarray, plant_mask: np.ndarray, bbox, balanced_ok=True) -> dict:
    """잎 색 지표 (조명 색을 맞춘 사진, 잎 가장자리의 배경과 섞인 픽셀은 빼고).

    hue: Lab 색상각 중앙값(°) — 초록 ≈ 120°, 노랑 ≈ 90°, 낮아질수록 노란 쪽
    chroma: 색의 진하기 중앙값, light: 밝기 중앙값(0~100)
    yellow: 노란 쪽(색상각 < 98°) 잎 픽셀 비율(%), yellow_low: 그중 식물 아래쪽 절반에 있는 비율(%)
    rgb: 대표 색 (화면 표시용, 밝기는 맞추고 색만), wb: 조명 색 보정을 했는지
    """
    inner = cv2.erode(plant_mask, _ellipse(5))
    if cv2.countNonZero(inner) < 300:
        inner = plant_mask
    sel = inner > 0
    if not np.any(sel):
        return {}
    light, _a, _b, hue, chroma = lab_planes(balanced)
    h, c = hue[sel], chroma[sel]
    yellow = (h < LEAF_YELLOW_HUE) & (c >= 20)
    rows = np.nonzero(sel)[0]
    _x, y, _w, bh = bbox
    n_yellow = int(np.count_nonzero(yellow))
    low = float(np.count_nonzero(yellow & (rows >= y + bh / 2))) / n_yellow * 100 if n_yellow >= 50 else None
    # 대표 색: 잎 색(a*·b* 중앙값)을 같은 밝기(L 60)로 그려요. 사진마다 노출이 달라도 색 차이만 보이게.
    swatch = np.uint8([[[round(60 * 2.55), round(float(np.median(_a[sel]))) + 128, round(float(np.median(_b[sel]))) + 128]]])
    bgr = cv2.cvtColor(np.clip(swatch, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)[0, 0]
    return {
        "hue": round(float(np.median(h)), 1),
        "chroma": round(float(np.median(c)), 1),
        "light": round(float(np.median(light[sel])), 1),
        "yellow": round(n_yellow / len(h) * 100, 1),
        "yellow_low": round(low) if low is not None else None,
        "rgb": "#{:02x}{:02x}{:02x}".format(int(bgr[2]), int(bgr[1]), int(bgr[0])),
        "wb": bool(balanced_ok),
    }


class PlantAnalyzer:
    def __init__(self, hsv_lower=(30, 40, 35), hsv_upper=(90, 255, 255)):
        self.hsv_lower = np.array(hsv_lower, dtype=np.uint8)
        self.hsv_upper = np.array(hsv_upper, dtype=np.uint8)

    # ---- 2~4단계: 전처리 + HSV Thresholding + 형태학적 연산 ----
    def segment(self, image: np.ndarray, view: str = "side") -> np.ndarray:
        """view: 'side' 옆에서 찍은 사진(정면·3D 측면) / 'top' 위에서 찍은 사진"""
        blurred = cv2.GaussianBlur(image, (3, 3), 0)  # 5x5 는 가는 줄기 색이 배경과 섞여 빠졌어요
        hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
        light, a_star, _b, hue_deg, chroma = lab_planes(blurred)
        hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
        greenish = (hue >= 20) & (hue <= 95)
        on = lambda cond: cond.astype(np.uint8) * 255  # noqa: E731
        # 1) HSV 범위 안이면서 확실히 초록인 픽셀 (흙·그림자·화분 그늘은 a* 가 0 근처라 빠져요)
        core = on((cv2.inRange(hsv, self.hsv_lower, self.hsv_upper) > 0) & (a_star <= GREEN_A_MAX))
        mask = core
        # 2) 가는 줄기 (옆 사진): 확실한 초록에 이어진 약한 초록만. 위 사진에서는 옆 화분으로 이어져서 쓰지 않아요.
        if view == "side":
            stem = on((a_star <= STEM_A_MAX) & (sat >= STEM_S_MIN) & (val >= 35) & greenish)
            mask = _grow(core, stem, STEM_GROW_STEPS)
        # 3) 노랗게 변한 잎: 초록 잎에 이어진 진한 노랑 (빼면 노란 잎은 '면적 감소'로만 보이고 색 변화는 못 봐요)
        yellow = on((hue_deg >= YELLOW_HUE[0]) & (hue_deg <= YELLOW_HUE[1]) & (chroma >= YELLOW_C_MIN)
                    & (light >= YELLOW_L_MIN))
        mask = _grow(mask, yellow, YELLOW_GROW_STEPS)
        # 4) 연한 잎: 밝고 살짝 초록인 픽셀 중 식물 바로 옆이면서 '두께가 있는' 부분만.
        #    잎 가장자리의 배경과 섞인 1~3px 테두리까지 더하면 면적이 18% 가까이 부풀어서 빼요.
        pale = on((a_star <= PALE_A_MAX) & (val >= PALE_V_MIN) & (sat >= PALE_S_MIN) & greenish)
        pale = cv2.morphologyEx(cv2.bitwise_and(pale, cv2.dilate(core, _ellipse(15))), cv2.MORPH_OPEN, _ellipse(7))
        mask = cv2.bitwise_or(mask, pale)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, _ellipse(3))  # 작은 점(잡음) 제거 — 가는 줄기는 남게 3px
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, _ellipse(5))  # 잎 사이 작은 빈틈 메우기
        return mask

    # ---- 5단계: 식물 영역 고르기 ----
    @staticmethod
    def select_plant(mask: np.ndarray, prefer: str = "largest"):
        """가장 큰 초록 덩어리를 중심으로, 그 근처에 있는 잎 조각들을 함께 식물로 봅니다.

        바질처럼 잎이 떨어져 보이는 경우에도 한 식물로 묶고,
        사진 가장자리에 걸친 옆 화분의 잎은 되도록 빼기 위한 규칙입니다.
        prefer="center" 이면 큰 덩어리들 중 화면 가운데에 가장 가까운 것을 중심으로 삼습니다
        (3D 측면 사진처럼 뒤쪽에 다른 화분이 함께 찍히기 쉬운 경우).
        """
        img_h, img_w = mask.shape[:2]
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_piece = img_w * img_h * 0.0005
        pieces = [c for c in contours if cv2.contourArea(c) >= min_piece]
        if not pieces:
            return [], None
        pieces.sort(key=cv2.contourArea, reverse=True)
        main = pieces[0]
        if prefer == "center":
            # 너무 작은 조각은 빼고, 좌우 가장자리에 걸친 덩어리(옆 화분)는 다른 후보가 있으면 뺍니다.
            # 어린 식물은 뒤쪽 화분보다 작을 수 있어 크기 기준은 가장 큰 덩어리의 10%로 느슨하게 둡니다.
            big = [c for c in pieces if cv2.contourArea(c) >= 0.1 * cv2.contourArea(pieces[0])]

            def at_edge(c):
                x, y, w, h = cv2.boundingRect(c)
                return x <= 1 or x + w >= img_w - 1

            inner = [c for c in big if not at_edge(c)]

            def center_dist(c):
                x, y, w, h = cv2.boundingRect(c)
                return abs(x + w / 2 - img_w / 2)

            main = min(inner or big, key=center_dist)
            pieces = [main] + [c for c in pieces if c is not main]
        if cv2.contourArea(main) < img_w * img_h * 0.003:
            return [], None

        # 떨어져 보이는 잎 조각: 지금까지 고른 식물과 '실제 틈'이 가까운 조각만 합쳐요.
        # (예전에는 경계 상자를 25% 넓혀 겹치면 합쳐서, 위에서 찍은 사진의 옆 화분 잎까지 묶였어요)
        _, _, mw, mh = cv2.boundingRect(main)
        gap = max(6.0, MERGE_GAP * max(mw, mh))
        selected = [main]
        chosen = np.zeros(mask.shape[:2], np.uint8)
        cv2.drawContours(chosen, [main], -1, 255, thickness=cv2.FILLED)
        rest = pieces[1:]

        def edges(c):
            """조각이 닿은 사진 가장자리 (왼·위·오른·아래)"""
            x, y, w, h = cv2.boundingRect(c)
            return {k for k, hit in (("l", x <= 1), ("t", y <= 1), ("r", x + w >= img_w - 1), ("b", y + h >= img_h - 1)) if hit}

        touched = edges(main)
        changed = True
        while changed and rest:
            changed = False
            # 고른 영역에서 각 픽셀까지의 거리
            dist = cv2.distanceTransform(cv2.bitwise_not(chosen), cv2.DIST_L2, 3)
            keep = []
            for c in rest:
                pts = c.reshape(-1, 2)
                # 식물이 닿지 않은 사진 가장자리에 걸친 조각은 옆 화분 잎이에요 (위에서 찍은 사진에 흔함)
                if edges(c) - touched:
                    keep.append(c)
                    continue
                if float(dist[pts[:, 1], pts[:, 0]].min()) <= gap:
                    selected.append(c)
                    cv2.drawContours(chosen, [c], -1, 255, thickness=cv2.FILLED)
                    changed = True
                else:
                    keep.append(c)
            rest = keep
        x0 = min(cv2.boundingRect(c)[0] for c in selected)
        y0 = min(cv2.boundingRect(c)[1] for c in selected)
        x1 = max(cv2.boundingRect(c)[0] + cv2.boundingRect(c)[2] for c in selected)
        y1 = max(cv2.boundingRect(c)[1] + cv2.boundingRect(c)[3] for c in selected)
        return selected, (int(x0), int(y0), int(x1 - x0), int(y1 - y0))

    def analyze(self, image: np.ndarray, roi=None, prefer: str = "largest", view: str = "side") -> AnalysisResult:
        """roi: 분석 영역 [x0, y0, x1, y1] (사진 크기에 대한 0~1 비율). 영역 밖 초록색은 무시합니다.
        view: 'side' 옆에서 찍은 사진(정면 사진·3D 측면) / 'top' 위에서 찍은 사진(3D 위)"""
        image = normalize_size(image)
        img_h, img_w = image.shape[:2]
        balanced, balanced_ok = white_balance(image)
        raw_mask = self.segment(balanced, view)
        roi_px = roi_to_pixels(roi, img_w, img_h)
        if roi_px:
            x0, y0, x1, y1 = roi_px
            limited = np.zeros_like(raw_mask)
            limited[y0:y1, x0:x1] = raw_mask[y0:y1, x0:x1]
            raw_mask = limited
        selected, bbox = self.select_plant(raw_mask, prefer=prefer)
        if not selected:
            raise PlantNotFoundError(
                ("분석 영역 안에서 식물을 찾지 못했어요. 영역을 넓히거나 " if roi_px else "사진에서 식물을 찾지 못했어요. ")
                + "식물이 잘 보이도록 밝은 곳에서 다시 찍거나, 설정에서 색상(HSV) 범위를 조정해 주세요."
            )

        # 선택한 윤곽선 내부 중 실제로 초록색인 픽셀만 식물로 셉니다 (잎 사이 구멍 제외).
        region = np.zeros_like(raw_mask)
        cv2.drawContours(region, selected, -1, 255, thickness=cv2.FILLED)
        plant_mask = cv2.bitwise_and(raw_mask, region)

        # ---- 6단계: 생육 지표 ----
        x, y, w, h = bbox
        area_px = int(cv2.countNonZero(plant_mask))
        mean_h, mean_s, mean_v, _ = cv2.mean(cv2.cvtColor(balanced, cv2.COLOR_BGR2HSV), mask=plant_mask)
        color = leaf_color(balanced, plant_mask, bbox, balanced_ok)

        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        warnings = self.quality_warnings(image, hsv, bbox, area_px, roi_px)
        _l, _a, _b, hue_deg, chroma = lab_planes(balanced)
        yellow_mask = (plant_mask > 0) & (hue_deg < LEAF_YELLOW_HUE) & (chroma >= 20)
        overlay = self.draw_overlay(image, plant_mask, selected, bbox, roi_px, yellow_mask)
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
            color=color,
        )

    @staticmethod
    def quality_warnings(image, hsv, bbox, area_px, roi_px=None):
        """계획서 '모. 영상 분석에서 발생할 수 있는 오차'를 줄이기 위한 촬영 상태 점검."""
        img_h, img_w = image.shape[:2]
        x, y, w, h = bbox
        warnings = []
        edge = 3
        bx0, by0, bx1, by1 = roi_px or (0, 0, img_w, img_h)
        if x <= bx0 + edge or y <= by0 + edge or x + w >= bx1 - edge or y + h >= by1 - edge:
            warnings.append("식물이 분석 영역 가장자리에 닿아 있어요. 영역을 넓혀 주세요." if roi_px
                            else "식물이 사진 가장자리에 닿아 있어요. 식물 전체가 나오게 찍으면 더 정확해요.")
        if float(np.mean(hsv[:, :, 2])) < 70:
            warnings.append("사진이 어두워요. 조명을 켜거나 밝은 곳에서 찍어 주세요.")
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        if cv2.Laplacian(gray, cv2.CV_64F).var() < 30:
            warnings.append("사진이 흐릿해요. 초점을 맞추고 흔들리지 않게 찍어 주세요.")
        if area_px > img_w * img_h * 0.6:
            warnings.append("초록색 영역이 너무 넓어요. 배경에 초록색 물건이 있는지 확인해 주세요.")
        return warnings

    @staticmethod
    def draw_overlay(image, plant_mask, contours, bbox, roi_px=None, yellow_mask=None):
        """분석 결과 이미지: 배경은 어둡게, 식물 영역은 초록(노란 쪽 잎은 주황)으로 강조, 높이·폭 상자 표시."""
        dim = (image * 0.45).astype(np.uint8)
        tint = np.full_like(image, (90, 200, 60))  # BGR 초록
        plant = cv2.addWeighted(image, 0.55, tint, 0.45, 0)
        out = np.where(plant_mask[..., None] > 0, plant, dim)
        if yellow_mask is not None and yellow_mask.any():
            warm = cv2.addWeighted(image, 0.5, np.full_like(image, (30, 170, 250)), 0.5, 0)  # BGR 주황
            out = np.where(yellow_mask[..., None], warm, out)
        cv2.drawContours(out, contours, -1, (255, 255, 255), 2, lineType=cv2.LINE_AA)
        x, y, w, h = bbox
        cv2.rectangle(out, (x, y), (x + w, y + h), (255, 255, 255), 1, lineType=cv2.LINE_AA)
        if roi_px:
            # 분석 영역: 노란 점선 테두리
            x0, y0, x1, y1 = roi_px
            for (ax, ay, bx, by) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
                length = max(abs(bx - ax), abs(by - ay))
                for t in range(0, int(length), 18):
                    s0, s1 = t / max(1, length), min(1, (t + 10) / max(1, length))
                    p0 = (int(ax + (bx - ax) * s0), int(ay + (by - ay) * s0))
                    p1 = (int(ax + (bx - ax) * s1), int(ay + (by - ay) * s1))
                    cv2.line(out, p0, p1, (60, 210, 250), 2, lineType=cv2.LINE_AA)
        return out


def roi_to_pixels(roi, img_w, img_h):
    """[x0, y0, x1, y1] (0~1 비율) → 정수 픽셀 좌표. 없거나 너무 작으면 None."""
    if not roi:
        return None
    x0, y0, x1, y1 = [min(1.0, max(0.0, float(v))) for v in roi]
    px = (int(x0 * img_w), int(y0 * img_h), int(round(x1 * img_w)), int(round(y1 * img_h)))
    if px[2] - px[0] < 20 or px[3] - px[1] < 20:
        return None
    return px


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
