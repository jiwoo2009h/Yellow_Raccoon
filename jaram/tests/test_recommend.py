from datetime import datetime, timedelta

from growth import summarize, with_units
from recommend import evaluate
from thresholds import GENERAL_DEFAULTS, SPECIES_DEFAULTS, merge_thresholds

START = datetime(2026, 10, 1, 9, 0)
NOW = START + timedelta(days=12)


def series_from(areas, days=None, heights=None, hue=60.0):
    days = days or list(range(0, 2 * len(areas), 2))
    heights = heights or [100 + i * 5 for i in range(len(areas))]
    ms = [
        {"id": i + 1, "taken_at": (START + timedelta(days=d)).isoformat(), "height_px": h,
         "width_px": h, "area_px": a, "hue": hue}
        for i, (a, d, h) in enumerate(zip(areas, days, heights))
    ]
    return with_units(ms)


def env_at(day, **values):
    base = {"temp": None, "humidity": None, "soil": None, "lux": None}
    base.update(values)
    return {"at": (START + timedelta(days=day)).isoformat(), **base}


def run(series, env=(), care=(), species="basil"):
    return evaluate(series, list(env), list(care), SPECIES_DEFAULTS[species], GENERAL_DEFAULTS, NOW)


def codes(result):
    return [r["code"] for r in result["recs"]]


GROWING = [1000, 1200, 1440, 1730, 2070, 2490]  # 약 10%/일
SLOWING = [1000, 1200, 1440, 1730, 1760, 1780]  # 마지막 구간에서 거의 멈춤


def test_growth_rate_formula():
    s = series_from([1000, 1200], days=[0, 2])
    assert s[1]["delta"]["area"] == 200
    assert s[1]["delta"]["area_pct"] == 20
    assert s[1]["delta"]["area_pct_per_day"] == 10  # (X2-X1)/X1 / (t2-t1)
    summary = summarize(s, window=2)
    assert summary["recent"]["area"]["per_day"] == 100  # (X2-X1)/(t2-t1)


def test_units_with_calibration():
    s = with_units([{"id": 1, "taken_at": START.isoformat(), "height_px": 400, "width_px": 200, "area_px": 10000}],
                   cm_per_px=0.025)
    assert s[0]["height"] == 10
    assert s[0]["width"] == 5
    assert abs(s[0]["area"] - 6.25) < 1e-9


def test_single_measurement_is_pending():
    r = run(series_from([1000]))
    assert r["status"] == "pending"
    assert codes(r) == ["baseline"]


def test_good_growth_and_stable_env_keeps_current_care():
    env = [env_at(d, temp=23, humidity=55, soil=50, lux=12000) for d in (6, 8, 10)]
    r = run(series_from(GROWING), env)
    assert r["status"] == "good"
    assert codes(r) == ["keep"]


def test_dry_soil_and_slowing_growth_recommends_water():
    env = [env_at(d, soil=s) for d, s in ((6, 35), (8, 25), (10, 18))]
    r = run(series_from(SLOWING), env)
    assert r["status"] == "care"
    assert codes(r)[0] == "water_needed"
    assert r["recs"][0]["action"]["kind"] == "water"
    assert any("18%" in x for x in r["recs"][0]["reasons"])


def test_dry_soil_but_growing_is_only_observed():
    """계획서: 토양 수분이 낮더라도 높이·면적이 증가하면 바로 물 부족으로 판단하지 않음"""
    env = [env_at(10, soil=18)]
    r = run(series_from(GROWING), env)
    assert r["status"] == "observe"
    assert "soil_low_watch" in codes(r)
    assert "water_needed" not in codes(r)


def test_watering_after_soil_reading_clears_dry_soil():
    env = [env_at(10, soil=18)]
    care = [{"at": (START + timedelta(days=10, hours=2)).isoformat(), "kind": "water"}]
    r = run(series_from(SLOWING), env, care)
    assert "water_needed" not in codes(r)


def test_low_light_and_slowing_growth_recommends_light_check():
    env = [env_at(d, lux=3000) for d in (6, 8, 10)]
    r = run(series_from(SLOWING), env)
    assert codes(r)[0] == "light_low"
    assert r["status"] == "care"


def test_single_low_light_reading_is_not_persistent():
    env = [env_at(6, lux=12000), env_at(8, lux=12000), env_at(10, lux=3000)]
    r = run(series_from(SLOWING), env)
    assert "light_low" not in codes(r)
    assert "slowing" in codes(r)


def test_low_light_but_growing_is_observed():
    env = [env_at(d, lux=3000) for d in (6, 8, 10)]
    r = run(series_from(GROWING), env)
    assert r["status"] == "observe"
    assert "light_low_watch" in codes(r)


def test_hot_lettuce_and_slowing_needs_env_check():
    env = [env_at(d, temp=28) for d in (6, 8, 10)]
    r = run(series_from(SLOWING), env, species="lettuce")
    assert codes(r)[0] == "env_check"
    assert "추대" in r["recs"][0]["body"]


def test_sudden_area_drop_is_flagged():
    r = run(series_from([1000, 1200, 1440, 1000]))
    assert "sudden_drop" in codes(r)


def test_slowing_without_env_data_asks_for_env():
    r = run(series_from(SLOWING))
    assert "slowing" in codes(r)
    rec = next(x for x in r["recs"] if x["code"] == "slowing")
    assert "환경" in rec["body"] or "토양" in rec["body"]


def test_hue_drop_is_flagged():
    s = series_from(GROWING)
    for e in s[-1:]:
        e["hue"] = 50
    r = run(s)
    assert "hue_drop" in codes(r)


def test_water_interval_without_soil_sensor():
    care = [{"at": (START + timedelta(days=6)).isoformat(), "kind": "water"}]
    r = run(series_from(GROWING), care=care)
    assert "water_interval" in codes(r)


def test_stale_env_is_ignored():
    env = [env_at(d, lux=3000) for d in (0, 1, 2)]  # 10일도 더 전
    r = run(series_from(SLOWING), env)
    assert "light_low" not in codes(r)


def test_merge_thresholds_keeps_defaults_and_coerces():
    merged = merge_thresholds({"species": {"basil": {"soil_min": "25", "unknown": 1, "hsv_lower": [1, 2]}},
                               "general": {"rate_window": 3.0}})
    assert merged["species"]["basil"]["soil_min"] == 25
    assert "unknown" not in merged["species"]["basil"]
    assert merged["species"]["basil"]["hsv_lower"] == SPECIES_DEFAULTS["basil"]["hsv_lower"]
    assert merged["general"]["rate_window"] == 3
    assert merged["species"]["lettuce"] == SPECIES_DEFAULTS["lettuce"]


def test_photos_too_close_together_stay_pending():
    s = series_from([1000, 1100], days=[0, 0.01])
    r = run(s)
    assert codes(r) == ["too_close"]
    assert r["status"] == "pending"


def test_today_sentence_and_weekly_advice():
    env = [env_at(10, temp=33, humidity=55, soil=50, lux=12000, light_hours=10),
           env_at(11, temp=32, humidity=55, soil=50, lux=12000, light_hours=10)]
    care = [{"at": (START + timedelta(days=11)).isoformat(), "kind": "water", "amount": 150}]
    res = run(series_from(GROWING), env, care)
    assert res["today"].startswith("오늘은") and res["today"].endswith("추천합니다.")
    weekly = {w["key"]: w for w in res["weekly"]}
    assert weekly["temp"]["status"] == "high"
    assert weekly["temp"]["target"] == 24  # 바질 18~30℃ 의 가운데
    assert "온도를 24℃ 정도로 맞춰 주시는 것을 추천합니다" in weekly["temp"]["text"]
    assert weekly["humidity"]["status"] == "ok"
    assert "습도를 유지하는 것을 추천합니다" in weekly["humidity"]["text"]
    assert weekly["light_hours"]["status"] == "low"
    assert weekly["water"]["n"] == 1 and weekly["water"]["total"] == 150


def test_weekly_advice_ignores_old_env_and_reports_no_water():
    res = run(series_from(GROWING), [env_at(1, temp=40)])
    keys = [w["key"] for w in res["weekly"]]
    assert "temp" not in keys
    assert res["weekly"][-1]["status"] == "none"


def test_yellow_leaf_rise_is_observed_and_explains_slowing():
    s = series_from(SLOWING)
    for i, e in enumerate(s):
        e["yellow_ratio"] = 0.5 if i < 4 else 18.0
    res = run(s)
    assert "yellow_leaf" in codes(res)
    assert "slowing" not in codes(res)
    assert res["status"] == "observe"


def test_sticker_scale_is_used_per_photo():
    ms = [
        {"id": 1, "taken_at": START.isoformat(), "height_px": 400, "width_px": 200, "area_px": 40000, "ref_cm_per_px": 0.025},
        {"id": 2, "taken_at": (START + timedelta(days=2)).isoformat(), "height_px": 500, "width_px": 250, "area_px": 50000, "ref_cm_per_px": 0.02},
        {"id": 3, "taken_at": (START + timedelta(days=4)).isoformat(), "height_px": 480, "width_px": 240, "area_px": 48000},
    ]
    s = with_units(ms)
    assert abs(s[0]["height"] - 10) < 1e-9
    assert abs(s[1]["height"] - 10) < 1e-9  # 더 가까이서 찍어도 같은 실제 크기
    # 스티커가 없는 사진은 다른 사진들의 환산값 중앙값(0.0225) 사용
    assert abs(s[2]["height"] - 480 * 0.0225) < 1e-9
    # 자 보정값이 있으면 스티커 없는 사진에 그 값을 사용
    assert abs(with_units(ms, 0.03)[2]["height"] - 480 * 0.03) < 1e-9
