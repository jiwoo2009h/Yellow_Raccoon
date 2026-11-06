from datetime import datetime, timedelta

import validation
from growth import with_units
from thresholds import default_thresholds

START = datetime(2026, 10, 1, 9, 0)
TH = default_thresholds()


def make_plant(pid, rates, soils, care_days=(), care_kind="water", lux=None):
    """하루 한 장씩 찍은 식물. rates: 날마다 면적 변화율(%), soils: 날마다 토양 수분"""
    area, ms, env = 1000.0, [], []
    for d in range(len(rates) + 1):
        if d:
            area *= 1 + rates[d - 1] / 100
        at = START + timedelta(days=d)
        ms.append({"id": d + 1, "taken_at": at.isoformat(), "height_px": 100 + d, "width_px": 100, "area_px": area})
        env.append({"at": at.isoformat(), "temp": 23, "humidity": 55, "soil": soils[d],
                    "lux": lux[d] if lux else 12000})
    care = [{"at": (START + timedelta(days=d, hours=3)).isoformat(), "kind": care_kind, "amount": 100} for d in care_days]
    return {"id": pid, "name": f"P{pid}", "species": "basil", "unit": "px", "series": with_units(ms),
            "env": env, "care": care, "scans": []}


RATES = [10, 10, 10, 10, 10, 1, 1, 10, 10]  # 6~7일 사이 생장이 거의 멈춤
DRY = [55, 50, 45, 50, 45, 40, 35, 20, 60, 55]  # 7일째 흙이 마름


def test_followed_water_recommendation_recovers():
    p = make_plant(1, RATES, DRY, care_days=(7,))
    events, points = validation.plant_events(p, TH)
    assert len(points) == 9
    water = [e for e in events if e["code"] == "water_needed"]
    assert len(water) == 1
    e = water[0]
    assert e["at"].startswith("2026-10-08T09:00")
    assert e["followed"] is True and e["care_at"].startswith("2026-10-08T12:00")
    assert e["recovered"] is True
    assert e["rate_change"] > 5          # 다음 구간 생장률이 회복
    assert e["soil_change"] == 40        # 20 -> 60


def test_unfollowed_and_late_care():
    soils = DRY[:8] + [18, 15]
    rates = [10, 10, 10, 10, 10, 1, 1, 0.5, 0.5]
    # 10일째 물: 9일 추천은 2일 안이라 '따름', 7·8일 추천은 2일이 지나서 '안 따름'
    late = make_plant(2, rates, soils, care_days=(10,))
    events, _ = validation.plant_events(late, TH)
    water = {e["at"][:10]: e for e in events if e["code"] == "water_needed"}
    assert set(water) == {"2026-10-08", "2026-10-09", "2026-10-10"}
    assert water["2026-10-08"]["followed"] is False and water["2026-10-09"]["followed"] is False
    assert water["2026-10-10"]["followed"] is True
    assert water["2026-10-08"]["recovered"] is False
    none = make_plant(3, rates, soils)
    assert all(e["followed"] is False for e in validation.plant_events(none, TH)[0] if e["action"])


def test_light_recommendation_counts_move_as_followed():
    lux = [12000] * 5 + [3000] * 5
    p = make_plant(3, RATES, [55] * 10, care_days=(7,), care_kind="move", lux=lux)
    events, _ = validation.plant_events(p, TH)
    light = [e for e in events if e["code"] == "light_low"]
    assert light and light[0]["followed"] is True


def test_validate_summary_groups():
    plants = [make_plant(1, RATES, DRY, care_days=(7,)),
              make_plant(2, [10, 10, 10, 10, 10, 1, 1, 1, 1], DRY[:8] + [18, 15])]
    # 2번 식물: 8→9일 생장률 1%/일 정도로 거의 그대로 -> 추천이 바뀌어도 '회복'으로 세지 않음
    rep = validation.validate(plants, TH)
    s = rep["summary"]
    assert s["evaluations"] == 18
    assert s["actionable"] >= 2 and s["followed"] == 1
    water = next(c for c in rep["by_code"] if c["code"] == "water_needed")
    assert water["yes"]["n"] == 1 and water["no"]["n"] >= 1
    assert water["yes"]["recovered"] == 1.0
    assert water["no"]["recovered"] == 0.0
    assert water["yes"]["rate_change"] > water["no"]["rate_change"]
    assert water["yes"]["small"] is True
    assert rep["by_code"][0]["level"] == "care"


def test_replay_uses_only_past_data():
    # 미래(8일째)의 높은 토양 수분이 7일째 판단에 섞이면 안 됨
    p = make_plant(1, RATES, DRY, care_days=(7,))
    points = validation.replay_plant(p, TH)
    day7 = next(pt for pt in points if pt["index"] == 7)
    assert day7["result"]["facts"]["soil"] == 20


def test_validation_api_and_csv(client):
    r = client.get("/api/validation")
    assert r.status_code == 200
    assert r.get_json()["summary"]["evaluations"] == 0
    csv = client.get("/api/validation.csv")
    assert csv.status_code == 200
    assert "추천 시점" in csv.get_data(as_text=True).splitlines()[0]
