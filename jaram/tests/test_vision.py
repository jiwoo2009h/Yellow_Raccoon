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
