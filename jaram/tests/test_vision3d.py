import math

import cv2
import numpy as np
import pytest

from vision3d import ScanError, compute_scan

R = 100  # 구 반지름 (0° 사진 픽셀)


def render_side(blobs, angle, scale=1.0, shift=0.0, size=(900, 800), base=700):
    """타원체들(x, 높이, z, a, b, c, 방향°)을 수평 방향 angle 에서 본 직교 투영 실루엣"""
    h, w = size
    img = np.zeros((h, w), np.uint8)
    th = math.radians(angle)
    for x, y, z, a, b, c, yaw in blobs:
        phi = math.radians(yaw)
        u = x * math.cos(th) + z * math.sin(th)
        half = math.sqrt((a * math.cos(phi - th)) ** 2 + (c * math.sin(phi - th)) ** 2)
        center = (int(round(w / 2 + shift + u * scale)), int(round(base - y * scale)))
        cv2.ellipse(img, center, (max(1, int(round(half * scale))), max(1, int(round(b * scale)))), 0, 0, 360, 255, -1)
    return img


def render_top(blobs, scale=1.0, orient=0, size=(800, 800)):
    h, w = size
    img = np.zeros((h, w), np.uint8)
    for x, _y, z, a, _b, c, yaw in blobs:
        X, Z, ang = x, z, yaw
        # 사람이 위 사진을 다른 방향으로 찍은 경우 흉내: 90° 회전·좌우 반전
        for _ in range(orient % 4):
            X, Z, ang = -Z, X, ang + 90
        if orient >= 4:
            X, ang = -X, 180 - ang
        cv2.ellipse(img, (int(round(w / 2 + X * scale)), int(round(h / 2 + Z * scale))),
                    (max(1, int(round(a * scale))), max(1, int(round(c * scale)))), ang, 0, 360, 255, -1)
    return img


SPHERE = [(0, R, 0, R, R, R, 0)]


def views(blobs, angles=(0, 90, 180, 270), scales=None, shifts=None):
    scales = scales or [1.0] * len(angles)
    shifts = shifts or [0.0] * len(angles)
    return [(a, render_side(blobs, a, s, d)) for a, s, d in zip(angles, scales, shifts)]


def test_sphere_four_sides_matches_bicylinder():
    res = compute_scan(views(SPHERE))
    expected = 16 / 3 * R ** 3  # 두 원기둥의 교집합 (측면 2방향의 시각 헐)
    assert res["method"] == "hull"
    assert abs(res["volume_px"] / expected - 1) < 0.05
    assert abs(res["height_px"] - 2 * R) <= 2
    assert abs(res["width_px"] - 2 * R) < 8 and abs(res["depth_px"] - 2 * R) < 8


def test_sphere_with_top_matches_tricylinder():
    res = compute_scan(views(SPHERE), top_mask=render_top(SPHERE, scale=0.8))
    expected = 8 * (2 - math.sqrt(2)) * R ** 3  # 세 원기둥의 교집합
    assert res["detail"]["top"]["used"]
    assert abs(res["volume_px"] / expected - 1) < 0.05


def test_handheld_scale_and_position_are_corrected():
    ideal = compute_scan(views(SPHERE))["volume_px"]
    shaky = compute_scan(views(SPHERE, scales=[1.0, 0.7, 1.3, 0.85], shifts=[0, 45, -60, 30]))
    assert abs(shaky["volume_px"] / ideal - 1) < 0.04
    assert [round(v["scale"], 2) for v in shaky["detail"]["views"]] == [1.0, round(1 / 0.7, 2), round(1 / 1.3, 2), round(1 / 0.85, 2)]


ASYM = [  # 한쪽으로 치우친 잎 두 장 + 가운데 줄기 (위 사진 방향을 가릴 수 있는 모양)
    (0, 60, 0, 12, 60, 12, 0),
    (70, 90, 10, 70, 18, 30, 20),
    (-30, 40, -50, 40, 15, 25, 110),
]


@pytest.mark.parametrize("orient", range(8))
def test_top_view_orientation_is_found(orient):
    side = views(ASYM, angles=(0, 90, 180, 270))
    ideal = compute_scan(side, top_mask=render_top(ASYM, scale=1.1, orient=0))
    turned = compute_scan(side, top_mask=render_top(ASYM, scale=1.1, orient=orient))
    assert turned["detail"]["top"]["used"]
    assert turned["detail"]["top"]["fit"] > 0.95
    assert not any("위 사진" in w for w in turned["warnings"])  # 올바른 위 사진에는 경고 없음
    assert abs(turned["volume_px"] / ideal["volume_px"] - 1) < 0.08
    assert turned["volume_px"] < compute_scan(side)["volume_px"]  # 위 사진이 실제로 더 깎음


def test_two_views_use_ellipse_sections():
    res = compute_scan(views(SPHERE, angles=(0, 90)))
    assert res["method"] == "ellipse2"
    assert abs(res["volume_px"] / (4 / 3 * math.pi * R ** 3) - 1) < 0.04


def test_bigger_plant_has_bigger_volume():
    small = compute_scan(views(ASYM))["volume_px"]
    grown = [(x * 1.2, y * 1.2, z * 1.2, a * 1.2, b * 1.2, c * 1.2, yaw) for x, y, z, a, b, c, yaw in ASYM]
    big = compute_scan(views(grown, scales=[1, 1.1, 0.9, 1.05]))["volume_px"]
    assert 1.5 < big / small < 1.9  # 1.2³ ≈ 1.73


def test_invalid_inputs():
    with pytest.raises(ScanError):
        compute_scan([(90, render_side(SPHERE, 90))])  # 0° 없음
    with pytest.raises(ScanError):
        compute_scan(views(SPHERE, angles=(0, 180)))  # 같은 방향뿐
    with pytest.raises(ScanError):
        compute_scan([(0, np.zeros((100, 100), np.uint8)), (90, render_side(SPHERE, 90))])


def test_mismatched_top_view_is_dropped_with_warning():
    blob = [(0, 60, 0, 20, 60, 20, 0)]
    res = compute_scan(views(blob), top_mask=render_top([(0, 0, 0, 200, 0, 30, 0)]))
    assert not res["detail"]["top"]["used"]
    assert any("위 사진" in w for w in res["warnings"])


def test_points_for_preview():
    res = compute_scan(views(SPHERE))
    pts = res["points"]
    assert 100 < len(pts) <= 5000
    ys = [p[1] for p in pts]
    assert min(ys) >= 0 and max(ys) <= 2 * R + 2


def test_axis_search_fixes_misestimated_axis(monkeypatch):
    """사진마다 밑동이 가려지는 정도가 달라 축 추정이 어긋나도(여기서는 +14px) 탐색으로 바로잡힘"""
    import vision3d
    ideal = compute_scan(views(ASYM, scales=[1, 0.9, 1.1, 1.0], shifts=[0, 20, -25, 10]))["volume_px"]
    orig = vision3d._axis_guess
    monkeypatch.setattr(vision3d, "_axis_guess", lambda sil: orig(sil) + 14)
    fixed = compute_scan(views(ASYM, scales=[1, 0.9, 1.1, 1.0], shifts=[0, 20, -25, 10]))
    monkeypatch.setattr(vision3d, "SEARCH", 0.0)
    unfixed = compute_scan(views(ASYM, scales=[1, 0.9, 1.1, 1.0], shifts=[0, 20, -25, 10]))["volume_px"]
    assert unfixed < ideal * 0.85, "축이 어긋나면 서로 깎아 부피가 줄어듦"
    assert abs(fixed["volume_px"] / ideal - 1) < 0.05
    assert any(abs(v["offset"]) > 10 for v in fixed["detail"]["views"])


def test_result_is_json_serializable():
    import json
    res = compute_scan(views(ASYM), top_mask=render_top(ASYM, scale=1.1, orient=3))
    json.dumps(res)  # numpy 값이 섞이면 실패
