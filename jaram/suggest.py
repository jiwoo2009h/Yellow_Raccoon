"""실험 데이터로 추천 기준값(임계값)을 자동 제안합니다.

계획서 4단계 "실험 데이터로 기준값 설정"을 돕는 기능입니다. 기준값을 바로 바꾸지 않고,
지금까지 모은 기록에서 설명 가능한 통계로 '제안값'과 그 근거를 계산해 보여 줍니다.
적용 여부는 사람이 고릅니다.

방법 (항목별)
  - 정체 기준(면적)      : 정상 구간(환경이 모두 현재 기준 안) 면적 생장률의 하위 10% (P10)
                           → 건강한 구간의 90%는 이보다 빨리 자랐다는 뜻(오경보 약 10%)
  - 급감 경고            : 평상시 음의 면적 변화(측정 오차)의 5백분위 절댓값 × 1.5
  - 토양 수분 최솟값     : 물을 주기 직전(24시간 안) 토양 수분의 중앙값
  - 온도·습도·조도 기준  : 잘 자란 구간(생장률 상위 절반)과 느린 구간(하위 25%)의 환경을 비교
      · 잘 자란 구간 값의 5백분위(조도 10백분위)·95백분위가 현재 기준 밖이면 → 그 값까지 넓히기
      · 현재 기준 안쪽인데 잘 자란 구간에서는 없던 값에서 느린 구간(하위 25% 이면서 중앙값의 절반 미만)이
        2번 이상 나오면 → 느린 구간 값과 잘 자란 구간 경계값의 가운데로 좁히기
      · 둘 다 아니면 바꾸지 않음 (관찰한 범위만으로는 한계를 알 수 없음)
  - 부피 정체 기준(3D)   : 정상 3D 구간 하루 평균 부피 생장률의 하위 10%
공통
  - 이상치는 IQR 규칙(Q1 − 1.5·IQR 미만, Q3 + 1.5·IQR 초과)으로 뺍니다.
  - 생장 구간이 MIN_INTERVALS(8)개보다 적으면 그 항목은 제안하지 않습니다.
  - 식물이 클수록 % 생장률은 자연히 낮아지므로, 지금 생장 단계와 비슷한 기간을 골라 제안받는 것이 좋습니다.
"""

import math
from datetime import datetime, timedelta

import numpy as np

from growth import MIN_DAYS, days_between, parse_time

MIN_INTERVALS = 8   # 생장 구간이 이보다 적으면 제안하지 않음
MIN_SAMPLES = 4     # 환경값·물주기 같은 개별 항목의 최소 표본 수
ENV_BEFORE = timedelta(hours=12)  # 구간 시작 12시간 전 기록까지 그 구간의 환경으로 봄
SOIL_BEFORE_WATER = timedelta(hours=24)

ITEMS = {
    "stagnation_rate": ("정체 기준", "%/일"),
    "drop_alert": ("급감 경고", "%"),
    "soil_min": ("토양 수분 최솟값", "%"),
    "temp_min": ("온도 최솟값", "℃"),
    "temp_max": ("온도 최댓값", "℃"),
    "humidity_min": ("습도 최솟값", "%"),
    "humidity_max": ("습도 최댓값", "%"),
    "lux_min": ("조도 최솟값", "lux"),
    "volume_stagnation_rate": ("부피 정체 기준", "%/일"),
}


def iqr_filter(values):
    """IQR 규칙으로 이상치를 뺀 값들과 뺀 개수"""
    vals = [float(v) for v in values if v is not None]
    if len(vals) < 4:
        return vals, 0
    q1, q3 = np.percentile(vals, [25, 75])
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    kept = [v for v in vals if lo <= v <= hi]
    return kept, len(vals) - len(kept)


def pct(values, q):
    return float(np.percentile(values, q))


def _round(key, value):
    """화면에 넣기 좋은 단위로 반올림 (0.5는 올림)"""
    half_up = lambda v: float(math.floor(v + 0.5))  # noqa: E731
    if key == "lux_min":
        return half_up(value / 100) * 100
    if key in ("temp_min", "temp_max"):
        return half_up(value * 2) / 2
    if key in ("stagnation_rate", "volume_stagnation_rate"):
        return half_up(value * 10) / 10
    return half_up(value)


def _in_period(at, start, end):
    t = parse_time(at)
    return (start is None or t >= start) and (end is None or t < end)


def growth_intervals(plants, start=None, end=None):
    """식물별 연속 사진 사이의 생장 구간 (면적 생장률 + 그 구간의 환경 평균)"""
    out = []
    for p in plants:
        series, env = p["series"], p["env"]
        for prev, cur in zip(series, series[1:]):
            if not (_in_period(prev["taken_at"], start, end) and _in_period(cur["taken_at"], start, end)):
                continue
            days = days_between(prev["taken_at"], cur["taken_at"])
            d = cur.get("delta") or {}
            if days < MIN_DAYS or d.get("area_pct_per_day") is None:
                continue
            t0 = parse_time(prev["taken_at"]) - ENV_BEFORE
            t1 = parse_time(cur["taken_at"])
            logs = [e for e in env if t0 <= parse_time(e["at"]) <= t1]
            mean = {}
            for key in ("temp", "humidity", "soil", "lux"):
                vals = [e[key] for e in logs if e.get(key) is not None]
                mean[key] = sum(vals) / len(vals) if vals else None
            out.append({
                "plant": p["name"], "start": prev["taken_at"], "end": cur["taken_at"], "days": days,
                "rate": d["area_pct_per_day"], "change": d["area_pct"], "env": mean,
            })
    return out


def soil_before_watering(plants, start=None, end=None):
    """물을 주기 직전(24시간 안)의 마지막 토양 수분 값들"""
    vals = []
    for p in plants:
        soil_logs = [e for e in p["env"] if e.get("soil") is not None]
        for c in p["care"]:
            if c["kind"] != "water" or not _in_period(c["at"], start, end):
                continue
            tw = parse_time(c["at"])
            before = [e for e in soil_logs if tw - SOIL_BEFORE_WATER <= parse_time(e["at"]) <= tw]
            if before:
                vals.append(float(before[-1]["soil"]))
    return vals


def scan_intervals(plants, start=None, end=None):
    out = []
    for p in plants:
        for sc in p.get("scans") or []:
            d = sc.get("delta") or {}
            if d.get("volume_pct_per_day") is None or not _in_period(sc["taken_at"], start, end):
                continue
            if not _in_period(parse_time(sc["taken_at"]) - timedelta(days=d["days"]), start, end):
                continue
            out.append(d["volume_pct_per_day"])
    return out


def env_in_range(env, t):
    """구간 환경 평균이 모두 현재 기준 안인지 (기록이 없는 항목은 판단하지 않음)"""
    checks = (
        ("temp", lambda v: t["temp_min"] <= v <= t["temp_max"]),
        ("humidity", lambda v: t["humidity_min"] <= v <= t["humidity_max"]),
        ("soil", lambda v: t["soil_min"] <= v <= t["soil_max"]),
        ("lux", lambda v: v >= t["lux_min"]),
    )
    return all(env.get(k) is None or ok(env[k]) for k, ok in checks)


def env_bound(key, current, good, poor, good_out):
    """잘 자란 구간·느린 구간의 환경값으로 기준 하나(최솟값 또는 최댓값)를 제안"""
    is_min = key.endswith("_min")
    q = (10 if key == "lux_min" else 5) if is_min else 95
    g = pct(good, q)
    unit = ITEMS[key][1]
    f = (lambda v: f"{v:,.0f}") if key == "lux_min" else (lambda v: f"{v:.1f}" if key.startswith("temp") else f"{v:.0f}")
    seen = f"잘 자란 구간 {len(good)}개 관찰 범위 {f(min(good))}–{f(max(good))}{unit} · 이상치 {good_out}개 제외"
    if (is_min and g < current) or (not is_min and g > current):
        return _item(key, current, g, len(good),
                     f"잘 자란 구간의 {q}백분위가 현재 기준 밖이에요 → 기준을 넓혀 정상 환경을 경고하지 않게",
                     seen)
    # 현재 기준이 못 잡는 느린 구간: 현재 기준 안쪽이면서, 잘 자란 구간에서는 한 번도 없던 값
    g_edge = min(good) if is_min else max(good)
    between = [v for v in poor if (current <= v < g_edge if is_min else g_edge < v <= current)]
    if len(between) >= 2:
        edge = max(between) if is_min else min(between)
        return _item(key, current, (edge + g_edge) / 2, len(good) + len(between),
                     "느린 구간이 현재 기준 안쪽에서 나왔어요 → 느린 구간 값과 잘 자란 구간 값의 가운데로 좁히기",
                     f"느린 구간 {len(between)}개가 {f(min(between))}–{f(max(between))}{unit} · " + seen)
    return _item(key, current, None, len(good), "", seen,
                 missing=f"현재 기준({f(current)}{unit})을 바꿀 근거가 없어요. 관찰한 범위만으로는 한계를 알 수 없어요.")


def _item(key, current, suggested=None, n=0, method="", basis="", missing=None):
    label, unit = ITEMS[key]
    if suggested is not None:
        suggested = _round(key, suggested)
    return {
        "key": key, "label": label, "unit": unit, "current": current, "suggested": suggested,
        "changed": suggested is not None and abs(suggested - current) > 1e-9,
        "n": n, "method": method, "basis": basis, "missing": missing,
    }


def suggest(plants, current, start=None, end=None):
    """종류 하나의 식물들 기록으로 기준값 제안 목록을 만듭니다.

    plants  : [{name, series(with_units), env, care, scans(scan_series)}, ...]
    current : 지금 쓰는 그 종류의 기준값 (thresholds 형태)
    start, end : 기초 데이터 기간 (datetime 또는 None)
    """
    t = current
    items = []
    intervals = growth_intervals(plants, start, end)
    n_int = len(intervals)
    short = None if n_int >= MIN_INTERVALS else f"생장 구간이 {n_int}개예요. {MIN_INTERVALS}개 이상 쌓이면 제안해요."

    # 정상 구간: 환경이 모두 현재 기준 안이고(기록이 없으면 판단 보류로 포함), 이상치가 아니며, 면적이 늘어난 구간
    rates, rate_out = iqr_filter([iv["rate"] for iv in intervals])
    lo_fence, hi_fence = (min(rates), max(rates)) if rates else (0, 0)
    env_ok = [iv for iv in intervals if env_in_range(iv["env"], t)]
    normal = [iv["rate"] for iv in env_ok if lo_fence <= iv["rate"] <= hi_fence and iv["rate"] > 0]
    if short:
        items.append(_item("stagnation_rate", t["stagnation_rate"], missing=short))
    elif len(normal) < MIN_SAMPLES:
        items.append(_item("stagnation_rate", t["stagnation_rate"], missing="환경이 기준 안이면서 면적이 늘어난 정상 구간이 너무 적어요."))
    else:
        items.append(_item("stagnation_rate", t["stagnation_rate"], pct(normal, 10), len(normal),
                           "정상 구간 면적 생장률의 하위 10% (P10) · 건강한 구간의 90%는 이보다 빨리 자랐어요",
                           f"정상 구간 {len(normal)}개 · 중앙값 {np.median(normal):.1f}%/일 · "
                           f"환경 기준 밖 {n_int - len(env_ok)}개·이상치 {rate_out}개 제외"))

    # 급감 경고: 평상시의 음의 변화(측정 오차)보다 충분히 큰 감소만 경고
    neg, neg_out = iqr_filter([iv["change"] for iv in intervals if iv["change"] is not None and iv["change"] < 0])
    if short:
        items.append(_item("drop_alert", t["drop_alert"], missing=short))
    elif len(neg) < 3:
        items.append(_item("drop_alert", t["drop_alert"],
                           missing=f"면적이 줄어든 구간이 {len(neg)}개뿐이라 측정 오차 크기를 알 수 없어요."))
    else:
        value = max(5.0, min(50.0, abs(pct(neg, 5)) * 1.5))
        items.append(_item("drop_alert", t["drop_alert"], value, len(neg),
                           "평상시 음의 면적 변화(측정 오차) 5백분위 절댓값 × 1.5",
                           f"면적이 줄어든 구간 {len(neg)}개 · 가장 큰 감소 쪽 5% {pct(neg, 5):.1f}% · 이상치 {neg_out}개 제외"))

    # 토양 수분 최솟값: 사람이 '물을 줘야겠다'고 판단한 시점의 토양 수분
    soil, soil_out = iqr_filter(soil_before_watering(plants, start, end))
    if len(soil) < MIN_SAMPLES:
        items.append(_item("soil_min", t["soil_min"],
                           missing=f"물 주기 직전 토양 수분 기록이 {len(soil)}개예요. {MIN_SAMPLES}개 이상 필요해요."))
    else:
        items.append(_item("soil_min", t["soil_min"], float(np.median(soil)), len(soil),
                           "물을 주기 직전(24시간 안) 토양 수분의 중앙값",
                           f"물주기 {len(soil)}회 · 범위 {min(soil):.0f}–{max(soil):.0f}% · 이상치 {soil_out}개 제외"))

    # 환경 기준: 잘 자란 구간(생장률 상위 절반)과 느린 구간(하위 25%)의 환경을 비교
    if not short:
        all_rates = [iv["rate"] for iv in intervals]
        med, q25 = float(np.median(all_rates)), pct(all_rates, 25)
        good = [iv for iv in intervals if iv["rate"] >= med]
        # 느린 구간: 하위 25%이면서 중앙값의 절반보다도 느린 구간 (모두 잘 자랐다면 느린 구간은 없음)
        poor = [iv for iv in intervals if iv["rate"] <= q25 and (med <= 0 or iv["rate"] < 0.5 * med)]
    else:
        good = poor = []
    for base, keys in (("temp", ("temp_min", "temp_max")), ("humidity", ("humidity_min", "humidity_max")),
                       ("lux", ("lux_min",))):
        gvals, g_out = iqr_filter([iv["env"][base] for iv in good if iv["env"][base] is not None])
        pvals = [iv["env"][base] for iv in poor if iv["env"][base] is not None]
        for key in keys:
            if short:
                items.append(_item(key, t[key], missing=short))
            elif len(gvals) < MIN_SAMPLES:
                items.append(_item(key, t[key], missing=f"잘 자란 구간의 {ITEMS[key][0][:2]} 기록이 {len(gvals)}개예요. {MIN_SAMPLES}개 이상 필요해요."))
            else:
                items.append(env_bound(key, t[key], gvals, pvals, g_out))
    # 최소 < 최대가 깨지면 그 범위는 제안하지 않음
    by_key = {it["key"]: it for it in items}
    for lo_key, hi_key in (("temp_min", "temp_max"), ("humidity_min", "humidity_max")):
        lo, hi = by_key[lo_key], by_key[hi_key]
        lo_v = lo["suggested"] if lo["suggested"] is not None else lo["current"]
        hi_v = hi["suggested"] if hi["suggested"] is not None else hi["current"]
        if lo_v >= hi_v:
            for it in (lo, hi):
                it.update(suggested=None, changed=False, missing="제안값끼리 최솟값이 최댓값보다 커져서 제안하지 않아요.")

    # 3D 부피 정체 기준
    vrates, v_out = iqr_filter(scan_intervals(plants, start, end))
    vnormal = [r for r in vrates if r > 0]
    if len(vrates) + v_out < MIN_INTERVALS:
        items.append(_item("volume_stagnation_rate", t["volume_stagnation_rate"],
                           missing=f"3D 측정 구간이 {len(vrates) + v_out}개예요. {MIN_INTERVALS}개 이상 쌓이면 제안해요."))
    elif len(vnormal) < MIN_SAMPLES:
        items.append(_item("volume_stagnation_rate", t["volume_stagnation_rate"], missing="부피가 늘어난 3D 구간이 너무 적어요."))
    else:
        items.append(_item("volume_stagnation_rate", t["volume_stagnation_rate"], pct(vnormal, 10), len(vnormal),
                           "정상 3D 구간 하루 평균 부피 생장률의 하위 10% (P10)",
                           f"3D 구간 {len(vnormal)}개 · 중앙값 {np.median(vnormal):.1f}%/일 · 이상치 {v_out}개 제외"))

    order = list(ITEMS)
    items.sort(key=lambda it: order.index(it["key"]))
    times = [iv["start"] for iv in intervals] + [iv["end"] for iv in intervals]
    return {
        "items": items,
        "summary": {
            "plants": [p["name"] for p in plants],
            "intervals": n_int,
            "outliers": rate_out,
            "scan_intervals": len(vrates) + v_out,
            "first": min(times) if times else None,
            "last": max(times) if times else None,
            "min_intervals": MIN_INTERVALS,
        },
    }


def parse_period(date_from, date_to):
    """'YYYY-MM-DD' 기간 → (시작, 끝) datetime. 끝 날짜는 그날 하루 전체를 포함."""
    start = datetime.fromisoformat(date_from) if date_from else None
    end = datetime.fromisoformat(date_to) + timedelta(days=1) if date_to else None
    return start, end
