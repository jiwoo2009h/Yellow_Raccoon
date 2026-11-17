"""사진으로 본 잎 색(조명 색을 맞춘 Lab 색상각·노란 비율·진하기)과 모양(높이 ÷ √면적) 변화에 따른 추천."""

from datetime import datetime, timedelta

from growth import with_units
from recommend import evaluate, leaf_color_facts, shape_facts
from thresholds import GENERAL_DEFAULTS, SPECIES_DEFAULTS

START = datetime(2026, 10, 1, 9, 0)


def at(day, hours=0):
    return (START + timedelta(days=day, hours=hours)).isoformat()


def color_series(hues, yellows=None, chromas=None, heights=None, areas=None, yellow_low=None, wb=True):
    """하루 한 장씩 찍은 사진. 면적은 하루 4%씩 늘고 모양(높이 ÷ √면적)은 그대로가 기본."""
    n = len(hues)
    yellows = yellows or [0.5] * n
    chromas = chromas or [32.0] * n
    areas = areas or [round(10000 * 1.04 ** i) for i in range(n)]
    heights = heights or [round(200 * 1.02 ** i) for i in range(n)]
    ms = [{
        "id": i + 1, "taken_at": at(i), "height_px": heights[i], "width_px": 150, "area_px": areas[i], "hue": 40,
        "color": {"hue": hues[i], "yellow": yellows[i], "chroma": chromas[i], "light": 50,
                  "yellow_low": yellow_low, "rgb": "#557733", "wb": wb},
    } for i in range(n)]
    return with_units(ms)


def run(series, care=(), env=(), observations=(), species="basil", now=None):
    now = now or START + timedelta(days=len(series) - 1, hours=2)
    return evaluate(series, list(env), list(care), SPECIES_DEFAULTS[species], GENERAL_DEFAULTS, now,
                    observations=list(observations))


def codes(r):
    return [x["code"] for x in r["recs"]]


def rec(r, code):
    return next(x for x in r["recs"] if x["code"] == code)


STEADY = [117, 116, 118, 117, 116, 117, 118, 117]


def test_stable_leaf_color_is_reported_in_keep_reasons():
    r = run(color_series(STEADY))
    assert codes(r) == ["keep"]
    assert any("잎 색 큰 변화 없음" in x for x in r["recs"][0]["reasons"])
    lc = r["facts"]["leaf_color"]
    assert lc["compared"] and not lc["yellowing"] and lc["base_hue"] == 117


def test_one_odd_photo_is_not_a_color_change():
    """조명·초점 때문에 한 장만 노랗게 나온 사진으로는 판단하지 않아요 (최근 2장이 모두 바뀌어야 함)."""
    r = run(color_series(STEADY[:-1] + [108]))
    assert not r["facts"]["leaf_color"]["yellowing"]
    assert "leaf_color" not in codes(r)


def test_long_tracked_yellowing_without_fertilizer_suggests_nutrient():
    hues = [118] * 14 + [111, 110]  # 16일 기록, 최근 2장이 7° 낮아짐
    r = run(color_series(hues))
    nut = rec(r, "nutrient")
    assert nut["action"]["kind"] == "fertilize" and nut["action"]["label"] == "비료 줬어요"
    assert "비료를 준 기록이 없어요" in nut["body"]
    assert any("잎 색상각 118° → 최근 111, 110°" in x for x in nut["reasons"])


def test_short_tracked_yellowing_checks_overwater_light_nutrient_in_order():
    r = run(color_series([118] * 6 + [111, 110]))
    lc = rec(r, "leaf_color")
    assert lc["title"] == "잎 색이 노란 쪽으로 변했어요"
    assert "조명 조건이 같았는지" in lc["body"] and "과습 → 빛 부족 → 양분 부족" in lc["body"]


def test_yellow_ratio_rise_also_counts():
    r = run(color_series(STEADY, yellows=[0.5] * 6 + [9.0, 11.0]))
    assert r["facts"]["leaf_color"]["yellowing"]
    assert any("노란 쪽 잎 비율 0.5% → 최근 9, 11%" in x for x in rec(r, "leaf_color")["reasons"])


def test_lower_old_leaves_yellowing_is_gentle():
    r = run(color_series(STEADY, yellows=[0.5] * 6 + [7.0, 8.0], yellow_low=90))
    old = rec(r, "old_leaves")
    assert old["level"] == "observe" and "떼어 주세요" in old["body"]
    assert any("아래쪽(오래된) 잎" in x for x in old["reasons"])


def test_cold_basil_with_yellowing_points_to_temperature():
    env = [{"at": at(d), "temp": 12, "humidity": None, "soil": None, "lux": None} for d in (5, 6, 7)]
    r = run(color_series([118] * 6 + [111, 110]), env=env)
    cold = rec(r, "cold_color")
    assert cold["level"] == "care" and cold["action"]["kind"] == "move"
    assert "바질은 추위에 약해서" in cold["body"]


def test_fertilizing_after_yellowing_shows_feedback_then_recovery():
    yellowed = color_series([118] * 6 + [111, 110])
    fert = [{"id": 9, "at": at(7, 1), "kind": "fertilize", "amount": None}]
    r = run(yellowed, care=fert)
    assert "fertilize_done" in codes(r) and "nutrient" not in codes(r)
    # 1주 뒤: 잎 색이 다시 진해짐 → 효과 확인
    later = color_series([111, 110, 111, 110, 110, 111, 117, 118])
    r2 = run(later, care=[{"id": 9, "at": at(5), "kind": "fertilize", "amount": None}])
    good = rec(r2, "color_recovered")
    assert good["level"] == "good"


def test_recent_fertilizer_then_yellowing_suspects_too_much():
    fert = [{"id": 9, "at": at(4), "kind": "fertilize", "amount": None}]
    r = run(color_series([118] * 6 + [111, 110]), care=fert)
    assert "fertilizer_excess" in codes(r)


def test_overwatering_absorbs_measured_yellowing():
    obs = [{"at": at(5), "soil_state": "wet", "signs": [], "care_id": None},
           {"at": at(7), "soil_state": "wet", "signs": [], "care_id": None}]
    r = run(color_series([118] * 6 + [111, 110]), observations=obs)
    over = rec(r, "overwater")
    assert any("잎 색상각" in x for x in over["reasons"])
    assert "leaf_color" not in codes(r) and "nutrient" not in codes(r)


def test_lettuce_stretching_up_is_observed_with_light_and_temperature_hint():
    heights = [200] * 6 + [330, 350]  # 면적은 그대로 늘고 높이만 위로
    r = run(color_series(STEADY, heights=heights), species="lettuce")
    st = rec(r, "stretching")
    assert st["level"] == "observe" and st["action"]["kind"] == "light"
    assert "꽃대" in st["body"] and any("모양 지수" in x for x in st["reasons"])


def test_paling_and_stretching_together_need_light_care():
    heights = [200] * 6 + [330, 350]
    chromas = [32.0] * 6 + [21.0, 20.0]  # 진하기 -36%
    r = run(color_series(STEADY, heights=heights, chromas=chromas), species="lettuce")
    st = rec(r, "stretching")
    assert st["level"] == "care" and st["body"].startswith("잎 색도 옅어졌어요")
    assert any("잎 색 진하기" in x for x in st["reasons"])


def test_paling_alone_points_to_light_then_nutrient():
    r = run(color_series(STEADY, chromas=[32.0] * 6 + [21.0, 20.0]))
    lc = rec(r, "leaf_color")
    assert lc["title"] == "잎 색이 옅어졌어요" and "빛이나 양분" in lc["body"]


def test_pale_sign_with_low_light_recommends_light():
    env = [{"at": at(d), "temp": None, "humidity": None, "soil": None, "lux": 2000} for d in (5, 6, 7)]
    obs = [{"at": at(7), "soil_state": None, "signs": ["pale"], "care_id": None}]
    r = run(color_series(STEADY), env=env, observations=obs)
    light = rec(r, "light_low")
    assert light["level"] == "care" and "잎 색이 옅어졌어요" in light["body"]


def test_color_and_shape_facts_need_four_recent_photos():
    s = color_series([118, 117, 110])
    now = START + timedelta(days=3)
    assert leaf_color_facts(s, SPECIES_DEFAULTS["basil"], now)["compared"] is False
    assert shape_facts(s, SPECIES_DEFAULTS["basil"], now) is None
    # 마지막 사진이 일주일보다 오래되면 비교 결과는 보여 주지만(stale) 추천에는 쓰지 않아요
    old = color_series([118] * 6 + [111, 110])
    later = START + timedelta(days=20)
    facts = leaf_color_facts(old, SPECIES_DEFAULTS["basil"], later)
    assert facts["compared"] and facts["yellowing"] and facts["stale"]
    r = run(old, now=later)
    assert "leaf_color" not in codes(r) and "nutrient" not in codes(r)


def test_photos_without_color_data_still_work():
    """잎 색 지표가 없는 예전 기록(다시 분석 전)도 그대로 판단해요."""
    s = color_series(STEADY)
    for e in s:
        e["color"] = None
    r = run(s)
    assert codes(r) == ["keep"] and r["facts"]["leaf_color"] is None
