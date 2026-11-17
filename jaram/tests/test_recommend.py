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
    recent_old = scans_from([1000, 1035], [0, 7])  # 7일: 최근 사진 3장(6·8·10일) 구간과 겹침
    assert run3d(series_from(GROWING), recent_old, general=longer)["facts"]["growth_source"] == "3d"
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


def test_scan_older_than_recent_photo_window_defers_to_2d():
    # 마지막 3D 측정(5일)은 7일 안이지만, 최근 생장률 구간(사진 6·8·10일)보다 앞섬 -> 새 사진(2D)이 우선
    env = [env_at(11, soil=20)]
    r = run3d(series_from(SLOWING), scans_from([1000, 1800], [0, 5]), env=env)
    assert r["facts"]["growth_source"] == "2d"
    assert r["facts"]["volume_stale"] is True
    assert "water_needed" in codes(r)
    assert "growth_mismatch" not in codes(r)


def test_scan_at_window_start_does_not_overlap():
    # 마지막 3D 측정이 정확히 최근 구간 시작(6일)이면 3D 구간(0~6일)과 최근 구간(6~10일)이 겹치지 않음
    r = run3d(series_from(SLOWING), scans_from([1000, 1800], [0, 6]))
    assert r["facts"]["volume_stale"] is True and r["facts"]["growth_source"] == "2d"


# ---------------------------------------------------------------- 급수 기록 · 흙 만져 보기 · 식물 특이사항
from recommend import water_facts  # noqa: E402


def at(day, hours=0):
    return (START + timedelta(days=day, hours=hours)).isoformat()


def water(day, amount=None, hours=0, cid=None):
    return {"id": cid, "at": at(day, hours), "kind": "water", "amount": amount}


def obs(day, soil=None, signs=(), hours=0, care_id=None):
    return {"at": at(day, hours), "soil_state": soil, "signs": list(signs), "care_id": care_id}


def run_obs(series, care=(), observations=(), env=(), species="basil"):
    return evaluate(series, list(env), list(care), SPECIES_DEFAULTS[species], GENERAL_DEFAULTS, NOW,
                    observations=list(observations))


def test_water_facts_groups_sessions_and_sums_last_week():
    care = [water(1, 100), water(1, 50, hours=2), water(4, 120), water(7, 150), water(10, 130),
            {"id": None, "at": at(11), "kind": "light", "amount": 12}]
    wf = water_facts(care, [], SPECIES_DEFAULTS["basil"], NOW)
    assert wf["count"] == 4  # 1일째 두 번(2시간 간격)은 한 번으로
    assert wf["interval_median"] == 3
    assert wf["count_7d"] == 2 and wf["amount_7d"] == 280
    assert wf["days_since"] == 2
    assert wf["next_check_at"] == at(13)[:16]
    assert wf["frequent"] is False
    assert water_facts([], [], SPECIES_DEFAULTS["basil"], NOW)["count"] == 0


def test_dry_touch_and_slowing_recommends_water():
    r = run_obs(series_from(SLOWING), observations=[obs(11, soil="dry")])
    assert r["status"] == "care"
    rec = next(x for x in r["recs"] if x["code"] == "water_needed")
    assert rec["action"]["kind"] == "water"
    assert any("흙을 만져 보니 말랐어요" in x for x in rec["reasons"])


def test_watering_after_dry_touch_clears_it():
    r = run_obs(series_from(SLOWING), care=[water(11, 150, hours=1)], observations=[obs(11, soil="dry")])
    assert "water_needed" not in codes(r)
    assert "water_interval" not in codes(r)


def test_soil_wet_twice_with_slowing_is_overwater():
    r = run_obs(series_from(SLOWING), observations=[obs(9, soil="wet"), obs(11, soil="wet")])
    rec = next(x for x in r["recs"] if x["code"] == "overwater")
    assert rec["level"] == "care"
    assert "바질은 과습에 약해요" in rec["body"]
    assert "받침" in rec["body"]


def test_frequent_watering_is_watched_when_growing_and_care_when_slowing():
    care = [water(9), water(10), water(11)]  # 하루 간격 (바질 기준 1.5일보다 자주)
    good = run_obs(series_from(GROWING), care=care)
    assert "overwater_watch" in codes(good) and good["status"] == "observe"
    assert good["facts"]["water"]["frequent"] is True
    slow = run_obs(series_from(SLOWING), care=care)
    assert "overwater" in codes(slow) and slow["status"] == "care"
    # 상추는 1일 기준이라 하루 간격은 괜찮아요
    assert "overwater_watch" not in codes(run_obs(series_from(GROWING), care=care, species="lettuce"))


def test_watering_wet_soil_is_flagged():
    r = run_obs(series_from(GROWING), care=[water(10, cid=7)], observations=[obs(10, soil="wet", care_id=7)])
    rec = next(x for x in r["recs"] if x["code"] == "overwater_watch")
    assert any("젖어 있을 때" in x for x in rec["reasons"])


def test_wilt_right_after_watering_is_not_water_shortage():
    r = run_obs(series_from(GROWING), care=[water(11, 150, hours=10)],
                observations=[obs(11, signs=["wilt"], hours=22)])
    assert "wilt_wet" in codes(r) and "water_needed" not in codes(r)
    rec = next(x for x in r["recs"] if x["code"] == "wilt_wet")
    assert rec["level"] == "care" and rec["action"] is None


def test_wilt_with_dry_soil_needs_water_even_if_growing():
    r = run_obs(series_from(GROWING), observations=[obs(11, soil="dry", signs=["wilt"])])
    rec = next(x for x in r["recs"] if x["code"] == "water_needed")
    assert rec["level"] == "care" and rec["action"]["kind"] == "water"
    assert "keep" not in codes(r)


def test_wilt_with_unknown_soil_checks_soil_first():
    r = run_obs(series_from(GROWING), care=[water(8)], observations=[obs(11, signs=["wilt"])])
    rec = next(x for x in r["recs"] if x["code"] == "water_needed")
    assert "흙 표면을 만져 보고" in rec["body"]
    assert any("마지막 급수 4일 전" in x for x in rec["reasons"])


def test_leggy_suggests_light_and_softens_when_lux_is_fine():
    r = run_obs(series_from(GROWING), observations=[obs(11, signs=["leggy"])])
    rec = next(x for x in r["recs"] if x["code"] == "light_leggy")
    assert rec["level"] == "care" and rec["action"]["kind"] == "light"
    bright = [env_at(d, lux=12000) for d in (8, 10, 11)]
    r2 = run_obs(series_from(GROWING), env=bright, observations=[obs(11, signs=["leggy"])])
    assert next(x for x in r2["recs"] if x["code"] == "light_leggy")["level"] == "observe"
    dark = [env_at(d, lux=3000) for d in (8, 10, 11)]
    r3 = run_obs(series_from(GROWING), env=dark, observations=[obs(11, signs=["leggy"])])
    assert codes(r3)[0] == "light_low" and r3["status"] == "care"  # 잘 자라도 웃자람이 보이면 관리


def test_yellow_leaves_after_fertilizer_suspects_too_much():
    care = [{"id": None, "at": at(9), "kind": "fertilize", "amount": None}]
    r = run_obs(series_from(GROWING), care=care, observations=[obs(11, signs=["yellow"])])
    rec = next(x for x in r["recs"] if x["code"] == "fertilizer_excess")
    assert rec["title"] == "잎이 노래졌어요"
    assert "비료" in rec["body"] and any("비료를 줬어요" in x for x in rec["reasons"])
    plain = next(x for x in run_obs(series_from(GROWING), observations=[obs(11, signs=["yellow"])])["recs"]
                 if x["code"] == "yellow_leaves")
    assert "과습 → 빛 부족 → 양분 부족" in plain["body"]


def test_yellow_with_wet_soil_goes_to_overwater():
    r = run_obs(series_from(GROWING), observations=[obs(9, soil="wet"), obs(11, soil="wet", signs=["yellow"])])
    assert "overwater" in codes(r) and "yellow_leaves" not in codes(r)


def test_bolting_lettuce_in_heat_needs_care():
    hot = [env_at(d, temp=27) for d in (8, 10, 11)]
    r = run_obs(series_from(GROWING), env=hot, observations=[obs(11, signs=["bolting"])], species="lettuce")
    rec = next(x for x in r["recs"] if x["code"] == "bolting")
    assert rec["level"] == "care" and "15~20℃" in rec["body"]
    cool = run_obs(series_from(GROWING), observations=[obs(11, signs=["bolting"])], species="lettuce")
    assert next(x for x in cool["recs"] if x["code"] == "bolting")["level"] == "observe"


def test_pest_and_crowded_signs():
    r = run_obs(series_from(GROWING), observations=[obs(11, signs=["pest", "crowded"])])
    rec = next(x for x in r["recs"] if x["code"] == "pest")
    assert rec["level"] == "care" and any("빽빽" in x for x in rec["reasons"])
    assert "crowded" not in codes(r)
    only = run_obs(series_from(GROWING), observations=[obs(11, signs=["crowded"])], species="lettuce")
    rec2 = next(x for x in only["recs"] if x["code"] == "crowded")
    assert rec2["level"] == "observe" and "솎아" in rec2["body"]


def test_tip_dry_with_low_humidity():
    dry_air = [env_at(d, humidity=30) for d in (8, 10, 11)]
    r = run_obs(series_from(GROWING), env=dry_air, observations=[obs(11, signs=["tip_dry"])])
    assert next(x for x in r["recs"] if x["code"] == "tip_dry")["level"] == "care"


def test_old_signs_expire():
    r = run_obs(series_from(GROWING), observations=[obs(5, signs=["wilt", "leggy"])])  # 7일 전
    assert codes(r) == ["keep"]


def test_moist_soil_after_watering_suppresses_interval_reminder():
    care = [water(6)]
    assert "water_interval" in codes(run_obs(series_from(GROWING), care=care))
    r = run_obs(series_from(GROWING), care=care, observations=[obs(11, soil="moist")])
    assert "water_interval" not in codes(r)


def test_keep_mentions_recent_watering():
    r = run_obs(series_from(GROWING), care=[water(7, 150), water(10, 120)])
    assert codes(r) == ["keep"]
    assert "최근 7일 물 2회 · 총 270ml" in r["recs"][0]["reasons"]
    assert r["facts"]["water"]["count"] == 2


def test_no_water_records_keep_status_unchanged():
    r = run_obs(series_from(GROWING))
    assert codes(r) == ["keep"] and r["facts"]["water"]["count"] == 0
    slow = run_obs(series_from(SLOWING))
    rec = next(x for x in slow["recs"] if x["code"] == "slowing")
    assert "물 준 날짜와 양" in rec["body"] and "흙 상태" in rec["body"]


def test_one_moist_watering_is_weak_evidence_two_is_overwater():
    """촉촉할 때 한 번 준 것은 관찰만, 두 번 이상이면 생장 감소와 함께 과습으로 봐요."""
    once = run_obs(series_from(SLOWING), care=[water(4, cid=1), water(7, cid=2), water(10, cid=3)],
                   observations=[obs(7, soil="moist", care_id=2)])
    assert "overwater" not in codes(once)
    watch = next(x for x in once["recs"] if x["code"] == "overwater_watch")
    assert watch["title"] == "흙이 마르기 전에 물을 줬어요" and "근거가 약하지만" in watch["body"]
    assert "slowing" in codes(once)  # 생장 감소의 원인은 아직 모름
    twice = run_obs(series_from(SLOWING), care=[water(4, cid=1), water(7, cid=2), water(10, cid=3)],
                    observations=[obs(7, soil="moist", care_id=2), obs(10, soil="moist", care_id=3)])
    assert "overwater" in codes(twice)


def test_watering_after_wilt_record_is_followed_not_wilt_wet():
    """시든 걸 기록한 뒤 물을 주면(추천을 따름) '흙이 마르지 않았는데 시들었어요'가 아니라 효과를 지켜봐요."""
    r = run_obs(series_from(GROWING), care=[water(11, 150, hours=5)],
                observations=[obs(11, soil="dry", signs=["wilt"], hours=2)])
    assert "wilt_wet" not in codes(r) and "water_needed" not in codes(r)
    rec = next(x for x in r["recs"] if x["code"] == "water_done")
    assert rec["level"] == "observe" and "다시 펴지는지" in rec["body"]
