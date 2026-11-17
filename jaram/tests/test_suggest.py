from datetime import datetime, timedelta

import suggest
from growth import scan_series, with_units
from thresholds import SPECIES_DEFAULTS

START = datetime(2026, 10, 1, 9, 0)
T = SPECIES_DEFAULTS["basil"]


def plant(name, areas, env=None, care=(), day_step=1.0, scans=None):
    """areas: 사진마다 투영 면적. env: 사진마다 {temp, humidity, soil, lux} (같은 시각에 기록)"""
    ms, logs = [], []
    for i, a in enumerate(areas):
        at = START + timedelta(days=i * day_step)
        ms.append({"id": i + 1, "taken_at": at.isoformat(), "height_px": 100, "width_px": 100, "area_px": a})
        if env:
            logs.append({"at": at.isoformat(), **{k: None for k in ("temp", "humidity", "soil", "lux")}, **env[i]})
    return {"name": name, "series": with_units(ms), "env": logs, "care": list(care), "scans": scans or []}


def items(res):
    return {it["key"]: it for it in res["items"]}


def grow(n, rates, base=1000.0):
    out = [base]
    for i in range(n - 1):
        out.append(out[-1] * (1 + rates[i % len(rates)] / 100))
    return out


OK_ENV = {"temp": 24, "humidity": 55, "soil": 50, "lux": 12000}


def test_too_few_intervals_suggests_nothing():
    res = suggest.suggest([plant("A", grow(5, [5]))], T)
    it = items(res)
    assert res["summary"]["intervals"] == 4
    assert all(x["suggested"] is None for x in res["items"])
    assert "8개 이상" in it["stagnation_rate"]["missing"]


def test_stagnation_is_p10_of_normal_intervals_only():
    rates = [4, 5, 6, 7, 8, 5, 6, 7, 6, 5, 4, 6]
    env = [dict(OK_ENV) for _ in range(13)]
    a = plant("A", grow(13, rates), env)
    # B 는 빛이 부족(조도 기준 밖)할 때 거의 안 자람 -> 정상 구간에서 빠져야 함
    env_b = [dict(OK_ENV, lux=3000) for _ in range(9)]
    b = plant("B", grow(9, [0.3]), env_b)
    res = suggest.suggest([a, b], T)
    st = items(res)["stagnation_rate"]
    import numpy as np
    assert abs(st["suggested"] - float(np.percentile(rates, 10))) <= 0.05
    assert st["n"] == 12
    assert "환경 기준 밖 8개" in st["basis"]
    assert st["changed"]


def test_drop_alert_from_negative_noise():
    rates = [6, -2, 5, -3, 7, -1, 6, -4, 5, 6]
    res = suggest.suggest([plant("A", grow(11, rates))], T)
    drop = items(res)["drop_alert"]
    import numpy as np
    negs = [x for x in rates if x < 0]
    assert drop["n"] == 4
    assert abs(drop["suggested"] - max(5, abs(np.percentile(negs, 5)) * 1.5)) <= 0.5


def test_soil_min_is_median_before_watering():
    env, care = [], []
    for i, soil in enumerate([42, 38, 45, 40, 39]):
        at = START + timedelta(days=i * 2)
        env.append({"at": (at - timedelta(hours=2)).isoformat(), "temp": None, "humidity": None, "soil": soil, "lux": None})
        care.append({"at": at.isoformat(), "kind": "water", "amount": 100})
    p = plant("A", grow(10, [5]), care=care)
    p["env"] = env
    res = suggest.suggest([p], T)
    soil = items(res)["soil_min"]
    assert soil["suggested"] == 40 and soil["n"] == 5


def test_env_bounds_widen_when_good_growth_seen_outside():
    # 31~33℃에서도 잘 자람 (현재 최댓값 30℃) -> 최댓값을 넓히자고 제안
    temps = [31, 32, 33, 32, 31, 33, 32, 31, 32, 33, 32, 31]
    env = [dict(OK_ENV, temp=t) for t in temps]
    res = suggest.suggest([plant("A", grow(12, [6, 7, 5, 6]), env)], T)
    tmax = items(res)["temp_max"]
    assert tmax["suggested"] is not None and tmax["suggested"] > 30
    assert "넓혀" in tmax["method"]
    # 관찰 범위 안쪽(최솟값)은 근거가 없으므로 그대로
    assert items(res)["temp_min"]["suggested"] is None
    assert "근거가 없어요" in items(res)["temp_min"]["missing"]


def test_env_bounds_tighten_when_slow_growth_inside_current_range():
    # 조도 12,000에서는 잘 자라고, 기준(8,000) 안쪽인 9,000에서는 거의 안 자람 -> 최솟값을 그 사이로 좁힘
    lux = [12000] * 8 + [9000] * 6
    rates = [7] * 7 + [0.2] * 6
    env = [dict(OK_ENV, lux=v) for v in lux]
    res = suggest.suggest([plant("A", grow(14, rates), env)], T)
    lm = items(res)["lux_min"]
    # 바뀌는 구간(12,000→9,000, 평균 10,500)도 느렸으므로 경계는 10,500과 12,000의 가운데
    assert lm["suggested"] == 11300  # 11,250 을 100 lux 단위로 반올림
    assert "좁히기" in lm["method"]
    assert lm["changed"]


def test_period_filter_and_volume():
    a = plant("A", grow(20, [5]))
    start, end = suggest.parse_period("2026-10-01", "2026-10-05")
    res = suggest.suggest([a], T, start, end)
    assert res["summary"]["intervals"] == 4  # 10.1~10.5 사진 5장
    rows = [{"id": i, "taken_at": (START + timedelta(days=3 * i)).isoformat(), "volume_px": 1000 * 1.2 ** i,
             "height_px": 1, "width_px": 1, "depth_px": 1, "top_area_px": 1} for i in range(10)]
    a["scans"] = scan_series(rows)
    vol = items(suggest.suggest([a], T))["volume_stagnation_rate"]
    assert vol["n"] == 9
    assert abs(vol["suggested"] - (1.2 ** (1 / 3) - 1) * 100) <= 0.05


def test_suggest_api(client):
    h = {"X-Requested-With": "jaram"}
    assert client.get("/api/settings/suggest?species=cactus").status_code == 400
    assert client.get("/api/settings/suggest?species=basil&from=2026-13-01").status_code == 400
    assert client.get("/api/settings/suggest?species=basil&from=2026-10-05&to=2026-10-01").status_code == 400
    r = client.get("/api/settings/suggest?species=lettuce", headers=h)
    body = r.get_json()
    assert r.status_code == 200
    assert body["label"] == "상추" and body["summary"]["intervals"] == 0
    assert {it["key"] for it in body["items"]} == set(suggest.ITEMS)
