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


# ---------------------------------------------------------------- 3D 부피 반영
from growth import scan_series  # noqa: E402


def scans_from(volumes, days):
    rows = [{"id": i + 1, "taken_at": (START + timedelta(days=d)).isoformat(), "volume_px": v,
             "height_px": 100, "width_px": 100, "depth_px": 100, "top_area_px": 1000}
            for i, (v, d) in enumerate(zip(volumes, days))]
    return scan_series(rows)


def run3d(series, scans, env=(), care=(), species="basil", general=None):
    return evaluate(series, list(env), list(care), SPECIES_DEFAULTS[species], general or GENERAL_DEFAULTS, NOW,
                    scans=scans)


def test_volume_growth_is_preferred_when_recent_scans_exist():
    r = run3d(series_from(GROWING), scans_from([1000, 1800], [3, 10]))  # 부피 +80% / 7일 = 하루 약 8.8%씩
    assert r["facts"]["growth_source"] == "3d"
    assert abs(r["facts"]["volume_rate"] - (1.8 ** (1 / 7) - 1) * 100) < 1e-9
    assert codes(r) == ["keep"]
    keep = r["recs"][0]
    assert "3D 부피" in keep["body"]
    assert keep["reasons"][0].startswith("3D 부피 생장률")
    assert any(x.startswith("정면 사진:") for x in keep["reasons"])


def test_volume_stagnation_overrides_2d_growth_and_flags_mismatch():
    # 정면 사진은 잘 자라지만 3D 부피는 7일 동안 +3.5% (0.5%/일 < 1.5%/일) -> 3D 우선 '둔화'
    env = [env_at(11, soil=20)]
    r = run3d(series_from(GROWING), scans_from([1000, 1035], [3, 10]), env=env)
    assert r["facts"]["growth_down"] is True
    assert r["facts"]["volume_stagnant"] is True
    assert r["facts"]["growth_mismatch"] is True
    assert "water_needed" in codes(r)
    assert "growth_mismatch" in codes(r)
    assert r["status"] == "care"
    water = next(x for x in r["recs"] if x["code"] == "water_needed")
    assert any("3D 부피 생장률" in x for x in water["reasons"])


def test_volume_growth_keeps_low_soil_as_observation_even_if_2d_slows():
    env = [env_at(11, soil=20)]
    r = run3d(series_from(SLOWING), scans_from([1000, 1800], [3, 10]), env=env)
    assert r["facts"]["growth_down"] is False
    assert "water_needed" not in codes(r)
    assert "soil_low_watch" in codes(r)
    mismatch = next(x for x in r["recs"] if x["code"] == "growth_mismatch")
    assert mismatch["level"] == "observe"
    assert "3D 부피는 잘 늘고" in mismatch["body"]


def test_volume_slowdown_against_previous_scan_interval():
    # 1구간 1.6배/5일 = 하루 9.9%, 2구간 1.15배/5일 = 하루 2.8% (71% 감소 > 50%) -> 둔화
    vols = [1000, 1600, 1840]
    r = run3d(series_from(GROWING), scans_from(vols, [0, 5, 10]))
    assert r["facts"]["volume_slowing"] is True
    assert r["facts"]["volume_stagnant"] is False
    assert "slowing" in codes(r)
    rec = next(x for x in r["recs"] if x["code"] == "slowing")
    assert any("그 전 3D 구간" in x for x in rec["reasons"])


def test_old_or_single_scans_fall_back_to_2d():
    old = scans_from([1000, 1035], [0, 3])  # 마지막 3D 측정이 9일 전 (기준 7일)
    r = run3d(series_from(GROWING), old)
    assert r["facts"]["growth_source"] == "2d"
    assert codes(r) == ["keep"]
    assert "높이와 투영 면적" in r["recs"][0]["body"]
    longer = dict(GENERAL_DEFAULTS, scan_max_age_days=10)
    assert run3d(series_from(GROWING), old, general=longer)["facts"]["growth_source"] == "3d"
    single = run3d(series_from(GROWING), scans_from([1000], [10]))
    assert single["facts"]["growth_source"] == "2d"


def test_scan_rate_needs_half_day_gap():
    s = scans_from([1000, 1300], [10, 10.2])
    assert s[1]["delta"]["volume_pct"] == 30
    assert s[1]["delta"]["volume_pct_per_day"] is None
    r = run3d(series_from(GROWING), s)
    assert r["facts"]["growth_source"] == "2d"


def test_new_volume_thresholds_merge_into_old_settings():
    stored = {"general": {"rate_window": 3}, "species": {"basil": {"stagnation_rate": 2}}}
    merged = merge_thresholds(stored)
    assert merged["general"]["scan_max_age_days"] == 7
    assert merged["species"]["basil"]["volume_stagnation_rate"] == 1.5
    assert merged["species"]["lettuce"]["volume_slowdown_ratio"] == 50


def test_compound_volume_rate_does_not_flag_normal_young_growth():
    from growth import compound_rate
    assert abs(compound_rate(100, 200, 7) - (2 ** (1 / 7) - 1) * 100) < 1e-12
    assert compound_rate(100, 200, 0.2) is None and compound_rate(0, 10, 7) is None
    # 어린 식물: 1주차 4.8배, 2주차 2.8배. 단순 %/일로는 52% 둔화지만 하루 복리 생장률로는 약 37% 둔화(정상)
    r = run3d(series_from(GROWING), scans_from([100, 481, 1361], [-4, 3, 10]))
    assert r["facts"]["volume_slowing"] is False
    assert codes(r) == ["keep"]
