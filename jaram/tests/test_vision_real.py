"""실제 실험 사진(줄인 사본)으로 식물 인식 회귀 테스트.

예전 분할(HSV 범위만 + 경계 상자 25% 넓혀 합치기)에서 생긴 문제를 고정해요.
  - 위 사진: 어두운 흙·화분 그늘이 식물로 잡힘 (상추 위 사진 26% → 실제 약 20%)
  - 옆 화분 잎이 합쳐져 경계 상자가 사진 끝까지 감 (상추 측면 10.27, 바질 위 10.24)
"""

from pathlib import Path

import pytest

from thresholds import SPECIES_DEFAULTS
from vision import PlantAnalyzer, load_image

FIX = Path(__file__).parent / "fixtures"


def analyze(name, species, prefer):
    t = SPECIES_DEFAULTS[species]
    img = load_image((FIX / name).read_bytes())
    view = "top" if "_top" in name else "side"  # 위 사진은 3D 측정의 위 사진처럼 view="top"
    r = PlantAnalyzer(t["hsv_lower"], t["hsv_upper"]).analyze(img, prefer=prefer, view=view)
    x, y, w, h = r.bbox
    edge = x <= 3 or y <= 3 or x + w >= r.img_w - 3 or y + h >= r.img_h - 3
    return r, r.area_px / (r.img_w * r.img_h) * 100, edge


@pytest.mark.parametrize("name,species,prefer,lo,hi", [
    ("lettuce_side_neighbor.jpg", "lettuce", "center", 5, 9),
    ("lettuce_top_soil.jpg", "lettuce", "largest", 16, 24),
    ("basil_top_neighbor.jpg", "basil", "largest", 16, 24),
    ("basil_side.jpg", "basil", "center", 7, 11.5),
])
def test_real_photos_find_only_the_plant(name, species, prefer, lo, hi):
    r, area_pct, edge = analyze(name, species, prefer)
    assert lo <= area_pct <= hi, area_pct
    assert not edge, r.bbox  # 옆 화분 잎이 합쳐지면 경계 상자가 사진 끝에 닿아요


def test_neighbor_pot_leaves_are_not_merged_in_side_photo():
    r, _, _ = analyze("lettuce_side_neighbor.jpg", "lettuce", "center")
    assert r.bbox[2] < 0.55 * r.img_w  # 예전에는 화면 폭의 94%까지 넓어졌어요


def test_dark_soil_is_not_counted_as_leaf():
    r, _, _ = analyze("lettuce_top_soil.jpg", "lettuce", "largest")
    # 식물로 잡힌 픽셀의 평균 밝기: 흙(명도 60~75)이 섞이면 크게 낮아져요
    assert r.val > 150
