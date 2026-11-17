import cv2
import numpy as np
import pytest

from seed_demo import draw_plant
from vision import PlantAnalyzer, PlantNotFoundError, load_image


def jpeg(img):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return buf.tobytes()


def test_bigger_plant_has_bigger_metrics():
    analyzer = PlantAnalyzer()
    small = analyzer.analyze(draw_plant(0.2, "basil", seed=1))
    big = analyzer.analyze(draw_plant(0.6, "basil", seed=1))
    assert big.height_px > small.height_px
    assert big.width_px > small.width_px
    assert big.area_px > small.area_px * 1.5


def test_ruler_and_pot_are_not_counted_as_plant():
    img = draw_plant(0.4, "basil", seed=2)
    res = PlantAnalyzer().analyze(img)
    x, y, w, h = res.bbox
    ruler_x = int(img.shape[1] * 0.86)
    assert x + w < ruler_x, "노란 자가 식물 영역에 포함되면 안 됩니다"
    pot_top = int(img.shape[0] * 0.68)
    assert y + h < pot_top + 5, "화분이 식물 영역에 포함되면 안 됩니다"


def test_lettuce_is_detected_with_lettuce_range():
    res = PlantAnalyzer((25, 35, 40), (90, 255, 255)).analyze(draw_plant(0.5, "lettuce", seed=3))
    assert res.area_px > 5000


def test_resize_keeps_scale_consistent():
    """같은 장면을 다른 해상도로 찍어도 정규화 후 측정값이 비슷해야 합니다."""
    img = draw_plant(0.5, "basil", seed=4)
    big = cv2.resize(img, (img.shape[1] * 2, img.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
    a = PlantAnalyzer().analyze(img)
    b = PlantAnalyzer().analyze(big)
    assert abs(a.height_px - b.height_px) <= 4
    assert abs(a.area_px - b.area_px) / a.area_px < 0.03


def test_no_plant_raises():
    blank = np.full((800, 600, 3), 230, np.uint8)
    with pytest.raises(PlantNotFoundError):
        PlantAnalyzer().analyze(blank)


def test_dark_photo_gets_warning():
    res = PlantAnalyzer().analyze(draw_plant(0.4, "basil", seed=5, light=0.3))
    assert any("어두" in w for w in res.warnings)


def test_load_image_rejects_garbage():
    with pytest.raises(ValueError):
        load_image(b"not an image")


def test_load_image_roundtrip():
    img = draw_plant(0.3, "basil", seed=6)
    loaded = load_image(jpeg(img))
    assert loaded.shape == img.shape


# ---- 잎 색 · 가는 줄기 · 조명 색 보정 ----

def paint_lower_leaves(img, res, bgr, frac=0.55):
    """분석된 식물 영역 중 아래쪽(경계 상자 위에서 frac 아래)을 bgr 색으로 칠해요."""
    x, y, w, h = res.bbox
    scale = img.shape[0] / res.img_h
    big = cv2.resize(res.mask, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
    rows = np.arange(img.shape[0])[:, None]
    out = img.copy()
    out[big & (rows > (y + h * frac) * scale)] = bgr
    return out


def test_yellow_leaves_are_kept_and_measured():
    """노랗게 변한 잎도 식물 면적에 들어가고, 노란 비율·위치를 잡아요 (예전에는 면적에서 빠졌어요)."""
    analyzer = PlantAnalyzer()
    img = draw_plant(0.5, "basil", seed=7)
    healthy = analyzer.analyze(img)
    assert healthy.color["yellow"] < 1
    sick = analyzer.analyze(paint_lower_leaves(img, healthy, (40, 190, 215)))  # 진한 노랑
    assert abs(sick.area_px - healthy.area_px) / healthy.area_px < 0.05
    assert sick.color["yellow"] > 30
    assert sick.color["yellow_low"] >= 80  # 아래쪽 잎이 노래졌어요
    assert sick.color["hue"] < healthy.color["hue"]
    # 노란 자(기준물)는 여전히 식물이 아니에요
    assert sick.bbox[0] + sick.bbox[2] < int(img.shape[1] * 0.86)


def test_white_balance_keeps_leaf_color_stable():
    """조명 색이 달라도(푸른빛·누런빛) 잎 색상각이 거의 같아야 해요."""
    img = draw_plant(0.5, "basil", seed=8)
    base = PlantAnalyzer().analyze(img).color["hue"]
    for gains in ((1.0, 0.95, 0.82), (0.8, 0.92, 0.98)):  # BGR: 푸른 조명, 누런 조명 (실제 사진 정도)
        cast = np.clip(img.astype(np.float32) * gains, 0, 255).astype(np.uint8)
        res = PlantAnalyzer().analyze(cast)
        assert res.color["wb"] is True
        assert abs(res.color["hue"] - base) < 3, (gains, res.color["hue"], base)


def test_thin_weak_green_stem_counts_in_side_photo():
    """잎 아래의 연한 줄기(a* ≈ -5)도 식물 높이에 들어가요 (위에서 찍은 사진에서는 이어 붙이지 않아요)."""
    img = np.full((1280, 720, 3), 225, np.uint8)
    cv2.ellipse(img, (360, 420), (130, 90), 0, 0, 360, (40, 150, 60), -1)  # 진한 초록 잎
    cv2.line(img, (360, 500), (360, 700), (70, 100, 100), 9)  # 연한 줄기 (화분까지 약 200px)
    side = PlantAnalyzer().analyze(img)
    top = PlantAnalyzer().analyze(img, view="top")
    assert side.bbox[1] + side.bbox[3] > 690
    assert top.bbox[1] + top.bbox[3] < 560
