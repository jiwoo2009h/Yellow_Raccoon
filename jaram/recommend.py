"""규칙 기반(IF -> THEN) 식물 상태 판단 및 관리 행동 추천.

계획서 3-마(4단계)의 구조를 그대로 구현합니다.
  [식물 이미지 입력 -> 생육 지표 추출 -> 환경 데이터 입력 -> 생장률 계산
   -> 조건 비교 -> 식물 상태 판단 -> 관리 행동 추천 -> 결과 표시]

원칙 (계획서 '허. 다중 조건 판단')
  - 환경값 하나만 보고 판단하지 않습니다. 항상 '생장 변화'와 '환경 변화'를 함께 봅니다.
  - 예) 토양 수분이 낮아도 잘 자라고 있으면 '물 부족'이 아니라 '관찰'로 분류합니다.
  - 모든 추천에는 판단 근거(실제 수치)를 함께 붙여서 왜 그런 추천이 나왔는지 설명합니다.

입력은 생장량(사진·3D) + 급수 기록(날짜·양·물 주기 전 흙 상태) + 식물 특이사항(시듦·웃자람 등) + 환경입니다.
토양 수분계·조도계 값은 선택이고, 누구나 할 수 있는 '흙 만져 보기(말랐음/촉촉함/젖어 있음)'로도 판단합니다.
판단 근거는 농촌진흥청·농사로 재배 자료입니다 (ALGORITHM.md '참고 자료').
  - 물은 정해진 날짜가 아니라 흙 표면이 마른 것을 확인하고 주기, 받침 물 버리기, 날짜와 양 기록
  - 바질·로즈마리는 과습에 민감, 상추는 수분이 부족하면 시듦
  - 빛 부족 → 웃자람, 고온 → 상추 꽃대, 통풍 부족 → 습도 상승·병해
  - 잎이 노래지거나 시들고 생장이 느리면 햇빛·수분·온도·영양 확인

상태는 계획서 '노. 식물 상태 판단'의 세 가지로 나눕니다.
  good    = 정상 생육
  observe = 관찰 필요
  care    = 관리 필요 가능성
"""

import math
from datetime import timedelta

import rules as rules_mod
from growth import days_between, parse_time, summarize

# 식물 특이사항 (상태 기록에서 고르는 항목)
SIGN_LABELS = {
    "wilt": "시듦·처짐",
    "yellow": "잎이 노래짐",
    "pale": "잎 색이 연해짐",
    "leggy": "웃자람(줄기만 길게)",
    "bolting": "꽃대가 올라옴",
    "tip_dry": "잎 끝이 마름",
    "pest": "벌레·곰팡이·반점",
    "crowded": "잎이 빽빽하게 겹침",
}
# 흙 만져 보기
SOIL_LABELS = {"dry": "말랐음", "moist": "촉촉함", "wet": "젖어 있음"}
WATER_SESSION_HOURS = 6  # 이 시간 안에 이어서 준 물은 한 번으로 셉니다.
SOIL_STATE_MAX_AGE_DAYS = 2  # 흙 상태 기록은 이틀 동안만 '지금 흙 상태'로 씁니다.
FERTILIZER_LOOKBACK_DAYS = 7

LEVEL_RANK = {"info": 0, "good": 1, "observe": 2, "care": 3}
STATUS_LABELS = {
    "pending": "기록 중",
    "good": "정상 생육",
    "observe": "관찰 필요",
    "care": "관리 필요",
}
ACTION_LABELS = {
    "water": "물 줬어요",
    "light": "조명 조정했어요",
    "move": "위치 옮겼어요",
    "fertilize": "비료 줬어요",
}
ENV_MAX_AGE_DAYS = 7  # 이보다 오래된 환경 기록은 판단에 쓰지 않습니다.
PHOTO_MAX_AGE_DAYS = 7  # 마지막 사진이 이보다 오래되면 사진으로 본 잎 색·모양 변화로 판단하지 않습니다.
BASE_WINDOW_DAYS = 10  # 잎 색·모양 비교 기준: 최근 사진 2장 전 이 기간 안의 가장 오래된 사진 3장


def _n(value, digits=1):
    """숫자를 보기 좋게: 12.0 -> '12', 12.34 -> '12.3'"""
    text = f"{value:,.{digits}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _signed(value, digits=1):
    return ("+" if value > 0 else "") + _n(value, digits)


def _rec(code, level, title, body, reasons=None, action=None):
    return {
        "code": code,
        "level": level,
        "title": title,
        "body": body,
        "reasons": reasons or [],
        "action": {"kind": action, "label": ACTION_LABELS[action]} if action else None,
    }


def _latest(env_logs, key):
    for e in reversed(env_logs):
        if e.get(key) is not None:
            return e
    return None


def _recent_values(env_logs, key, lookback):
    return [e[key] for e in env_logs if e.get(key) is not None][-lookback:]


def _persistent(values, predicate, count):
    return len(values) >= count and sum(1 for v in values if predicate(v)) >= count


def _when(at, now):
    """기록 시각을 '오늘'·'어제'·'n일 전'으로"""
    d = (parse_time(now).date() - parse_time(at).date()).days
    return "오늘" if d <= 0 else "어제" if d == 1 else f"{d}일 전"


def done_since_days(care_logs, kind, now, days):
    """최근 days 일 안에 그 관리를 했는지"""
    now = parse_time(now)
    return any(c["kind"] == kind and 0 <= (now - parse_time(c["at"])).total_seconds() / 86400 <= days
               for c in care_logs)


def _median(values):
    v = sorted(values)
    if not v:
        return None
    mid = len(v) // 2
    return v[mid] if len(v) % 2 else (v[mid - 1] + v[mid]) / 2


def water_facts(care_logs, observations, t, now):
    """급수 기록표 지표: 마지막 급수, 급수 간격, 최근 7일 횟수·양, 흙 확인 권장일, 너무 잦은 급수.

    6시간 안에 이어서 준 물은 한 번(같은 급수)으로 묶습니다. 물 주기 전 흙 상태는 그 급수 기록에 붙은
    상태 기록(observations.care_id)에서 읽습니다.
    """
    now = parse_time(now)
    waters = sorted((c for c in care_logs if c["kind"] == "water" and parse_time(c["at"]) <= now),
                    key=lambda c: parse_time(c["at"]))
    sessions = []
    for c in waters:
        at = parse_time(c["at"])
        amount = c.get("amount")
        if sessions and (at - sessions[-1]["last"]).total_seconds() <= WATER_SESSION_HOURS * 3600:
            s = sessions[-1]
            s["last"] = at
            s["logs"].append(c)
            if amount:
                s["amount"] = (s["amount"] or 0) + amount
        else:
            sessions.append({"start": at, "last": at, "amount": amount or None, "logs": [c]})
    interval_days = t.get("water_interval_days", 3)
    frequent_days = t.get("water_frequent_days", 1.5)
    out = {
        "count": len(sessions), "last_at": None, "days_since": None, "interval_median": None, "intervals_n": 0,
        "count_7d": 0, "amount_7d": None, "next_check_at": None, "frequent": False, "wet_waterings": 0,
        "moist_waterings": 0, "recent_n": 0, "interval_days": interval_days, "frequent_days": frequent_days,
    }
    if not sessions:
        return out
    last = sessions[-1]
    intervals = [(b["start"] - a["start"]).total_seconds() / 86400 for a, b in zip(sessions, sessions[1:])][-4:]
    week = [s for s in sessions if s["start"] >= now - timedelta(days=7)]
    amounts = [s["amount"] for s in week if s["amount"]]
    by_care = {o.get("care_id"): o for o in observations if o.get("care_id")}
    recent = sessions[-3:]

    def before(s):
        """그 급수 때 물 주기 전에 만져 본 흙 상태들"""
        return {(by_care.get(c.get("id")) or {}).get("soil_state") for c in s["logs"]}

    # 흙이 젖어 있는데 또 줌(강한 과습 근거) / 촉촉할 때 줌(한 번은 약한 근거, 두 번 이상이면 과습 근거)
    wet = sum(1 for s in recent if "wet" in before(s))
    moist = sum(1 for s in recent if "moist" in before(s) and "wet" not in before(s))
    med = _median(intervals)
    out.update({
        "last_at": last["last"].isoformat(timespec="minutes"),
        "days_since": days_between(last["last"], now),
        "interval_median": med,
        "intervals_n": len(intervals),
        "count_7d": len(week),
        "amount_7d": sum(amounts) if amounts else None,
        "next_check_at": (last["last"] + timedelta(days=interval_days)).isoformat(timespec="minutes"),
        "frequent": len(intervals) >= 2 and med < frequent_days,
        "wet_waterings": wet,
        "moist_waterings": moist,
        "recent_n": len(recent),
        "last_log": last["logs"][-1],
    })
    return out


def volume_facts(scans, t, general, now):
    """최근 3D 측정 두 번 이상으로 부피 생장률·둔화·정체를 판단합니다.

    scans : growth.scan_series() 결과 (완료된 3D 측정, 시각 순)
    반환값이 None 이면 3D 근거가 없어서 정면 사진(2D)만으로 판단합니다.
    """
    if not scans or len(scans) < 2:
        return None
    max_age = general.get("scan_max_age_days", 7)
    last = scans[-1]
    if days_between(last["taken_at"], now) > max_age:
        return None
    d = last.get("delta") or {}
    rate = d.get("volume_pct_per_day")
    if rate is None:
        return None
    prev_d = (scans[-2].get("delta") or {}) if len(scans) >= 3 else {}
    prev = prev_d.get("volume_pct_per_day")
    slowing = prev is not None and prev > 0 and rate < prev * (1 - t["volume_slowdown_ratio"] / 100)
    stagnant = rate < t["volume_stagnation_rate"]
    down = slowing or stagnant
    reasons = [f"3D 부피 생장률 하루 평균 {_signed(rate)}% (최근 3D 측정 {_n(d['days'])}일 간격, 부피 {_signed(d['volume_pct'])}%)"]
    if slowing:
        reasons.append(f"그 전 3D 구간(하루 {_signed(prev)}%)보다 {_n((1 - rate / prev) * 100, 0)}% 느려졌어요")
    elif stagnant:
        reasons.append(f"부피 정체 기준(하루 {_n(t['volume_stagnation_rate'])}%)보다 낮아요")
    return {
        "rate": rate, "prev": prev, "slowing": slowing, "stagnant": stagnant,
        "down": down, "growing": not down and rate > 0, "days": d["days"],
        "age_days": days_between(last["taken_at"], now), "reasons": reasons,
    }


def _mean(values):
    return sum(values) / len(values) if values else None


def _sustained(base, recent, threshold, direction):
    """최근 값들이 모두 기준(base)에서 같은 쪽(direction: +1 늘어남, -1 줄어듦)으로 threshold 의 60% 이상
    바뀌었고, 평균 변화가 threshold 이상인지 (사진 한 장만 튀는 값으로 판단하지 않기 위해)."""
    changes = [(v - base) * direction for v in recent]
    return bool(changes) and all(c >= threshold * 0.6 for c in changes) and _mean(changes) >= threshold


def _compare_points(points, now):
    """(기준 사진들, 최근 사진 2장). 최근 사진 2장 전 BASE_WINDOW_DAYS 안의 가장 오래된 사진 3장을 기준으로 해서
    '지금'과 '약 일주일 전'을 비교해요. 사진이 4장보다 적으면 (None, None).
    마지막 사진이 PHOTO_MAX_AGE_DAYS 보다 오래됐으면 비교 결과는 보여 주되(stale) 추천에는 쓰지 않아요."""
    if len(points) < 4:
        return None, None
    recent = points[-2:]
    prior = [s for s in points[:-2] if days_between(s["taken_at"], recent[0]["taken_at"]) <= BASE_WINDOW_DAYS]
    if len(prior) < 2:
        return None, None
    return prior[:3], recent


def leaf_color_facts(series, t, now):
    """사진으로 본 잎 색 변화 (조명 색을 맞춘 Lab 색상각·노란 비율·진하기, vision.leaf_color).

    노란 쪽으로 변함(yellowing): 색상각이 leaf_hue_drop° 이상 낮아짐 또는 노란 잎 비율이 yellow_rise%p 이상 늘어남
    옅어짐(paling): 노래지지는 않았는데 진하기(채도)가 pale_drop% 이상 줄어듦
    다시 진해짐(greening): 색상각이 다시 높아지거나 노란 잎 비율이 줄어듦 (비료·빛 조정 효과 확인용)
    """
    pts = [s for s in series if (s.get("color") or {}).get("hue") is not None]
    if not pts:
        return None
    latest = pts[-1]["color"]
    out = {
        "hue": latest["hue"], "yellow": latest.get("yellow"), "chroma": latest.get("chroma"),
        "rgb": latest.get("rgb"), "taken_at": pts[-1]["taken_at"], "n": len(pts),
        "base_hue": None, "base_yellow": None, "base_rgb": None, "base_from": None,
        "hue_change": None, "yellow_change": None, "chroma_change_pct": None, "where": None,
        "yellowing": False, "paling": False, "greening": False, "compared": False, "wb_ok": True, "reasons": [],
        "stale": days_between(pts[-1]["taken_at"], now) > PHOTO_MAX_AGE_DAYS,
    }
    base_pts, recent_pts = _compare_points(pts, now)
    if not base_pts:
        return out
    base = [s["color"] for s in base_pts]
    recent = [s["color"] for s in recent_pts]
    b_hue = _median([c["hue"] for c in base])
    b_yel = _median([c.get("yellow") or 0 for c in base])
    b_chr = _median([c["chroma"] for c in base if c.get("chroma")])
    r_hue = [c["hue"] for c in recent]
    r_yel = [c.get("yellow") or 0 for c in recent]
    r_chr = [c["chroma"] for c in recent if c.get("chroma")]
    hue_down = _sustained(b_hue, r_hue, t["leaf_hue_drop"], -1)
    yel_up = _sustained(b_yel, r_yel, t["yellow_rise"], +1)
    yellowing = hue_down or yel_up
    chr_pct = [v / b_chr * 100 for v in r_chr] if b_chr and len(r_chr) == len(recent) else []
    paling = not yellowing and bool(chr_pct) and _sustained(100.0, chr_pct, t["pale_drop"], -1)
    greening = not yellowing and (_sustained(b_hue, r_hue, t["leaf_hue_drop"], +1)
                                  or (b_yel >= t["yellow_rise"] and _sustained(b_yel, r_yel, t["yellow_rise"], -1)))
    low = latest.get("yellow_low")
    where = None
    if yellowing and low is not None:
        where = "low" if low >= 65 else "high" if low <= 35 else "all"
    since = _when(base_pts[0]["taken_at"], now)
    reasons = []
    if hue_down or greening:
        reasons.append(f"잎 색상각 {_n(b_hue)}° → 최근 {', '.join(_n(v) for v in r_hue)}° ({since} 사진 기준, "
                       + ("낮을수록 노란 쪽" if hue_down else "높을수록 진한 초록") + ")")
    if yel_up or (greening and b_yel >= t["yellow_rise"]):
        reasons.append(f"노란 쪽 잎 비율 {_n(b_yel)}% → 최근 {', '.join(_n(v) for v in r_yel)}%")
    if paling:
        reasons.append(f"잎 색 진하기 {_signed(_mean(chr_pct) - 100, 0)}% ({since} 사진 기준, "
                       f"{_n(t['pale_drop'])}% 이상 줄면 '옅어짐')")
    if where == "low":
        reasons.append("노란 부분이 주로 아래쪽(오래된) 잎에 있어요")
    elif where == "high":
        reasons.append("노란 부분이 주로 위쪽(새로 난) 잎에 있어요")
    wb_ok = all(c.get("wb", True) for c in recent)
    if (yellowing or paling or greening) and not wb_ok:
        reasons.append("흰 배경이 없어 조명 색을 맞추지 못한 사진이 섞여 있어요")
    out.update({
        "base_hue": b_hue, "base_yellow": b_yel, "base_rgb": base[0].get("rgb"), "base_from": base_pts[0]["taken_at"],
        "hue_change": _mean(r_hue) - b_hue, "yellow_change": _mean(r_yel) - b_yel,
        "chroma_change_pct": (_mean(chr_pct) - 100) if chr_pct else None, "where": where,
        "yellowing": yellowing, "paling": paling, "greening": greening, "compared": True, "wb_ok": wb_ok,
        "reasons": reasons,
    })
    return out


def shape_facts(series, t, now):
    """모양 지수 = 높이 ÷ √투영 면적 (옆에서 찍은 사진). 커지면 옆보다 위로 길쭉하게 자라는 것
    (빛이 부족한 웃자람, 상추는 고온의 꽃대). 픽셀끼리 나누므로 자 보정과 무관해요."""
    pts = [s for s in series if s.get("height_px") and s.get("area_px")]
    base_pts, recent_pts = _compare_points(pts, now)
    if not base_pts:
        return None
    index = [s["height_px"] / math.sqrt(s["area_px"]) for s in base_pts + recent_pts]
    base = _median(index[:len(base_pts)])
    recent = index[len(base_pts):]
    change = (_mean(recent) / base - 1) * 100
    stretching = _sustained(100.0, [v / base * 100 for v in recent], t["stretch_rise"], +1)
    return {
        "index": round(recent[-1], 2), "base_index": round(base, 2), "change_pct": change, "stretching": stretching,
        "stale": days_between(pts[-1]["taken_at"], now) > PHOTO_MAX_AGE_DAYS,
        "reasons": [f"모양 지수(높이 ÷ √면적) {base:.2f} → 최근 {', '.join(f'{v:.2f}' for v in recent)} "
                    f"({_when(base_pts[0]['taken_at'], now)} 사진 기준 {_signed(change, 0)}%, "
                    f"{_n(t['stretch_rise'])}% 이상 커지면 위로 길쭉해짐)"],
    }


def evaluate(series, env_logs, care_logs, species, general, now, unit="px", scans=None, observations=None,
             rules=None):
    """식물 하나의 상태와 추천 목록을 계산합니다.

    series       : growth.with_units() 결과 (촬영 시각 순)
    env_logs     : [{at, temp, humidity, soil, lux}, ...] (시각 순)
    care_logs    : [{id, at, kind, amount}, ...] (시각 순)
    species      : 종류별 기준값 (thresholds.SPECIES_DEFAULTS 형태)
    general      : 공통 기준값
    scans        : growth.scan_series() 결과 (3D 측정). 최근 것이 2개 이상이면 생장 판단에 우선 사용
    observations : 식물 상태 기록 [{at, soil_state, signs: [...], care_id}, ...] (시각 순)
    rules        : rules.load() 결과 (행동 추천 규칙). 없으면 기본 규칙 파일 rules.md
    """
    observations = observations or []
    t = species
    window = general.get("rate_window", 2)
    lookback = general.get("env_lookback", 3)
    persist = general.get("persist_count", 2)
    summary = summarize(series, window)
    n = len(series)

    facts = {"count": n, "unit": unit}
    if n == 0:
        rec = _rec("no_data", "info", "첫 사진을 찍어 주세요",
                   "사진을 한 장 찍으면 그 사진을 기준으로 생장량을 비교하기 시작해요.")
        return _result("pending", [rec], facts, summary)
    if n == 1:
        rec = _rec("baseline", "info", "기준 사진을 저장했어요",
                   "다음 촬영부터 이 사진과 비교해서 얼마나 자랐는지 알려드릴게요. "
                   "같은 위치·거리에서 찍으면 더 정확해요.")
        return _result("pending", [rec], facts, summary)

    # ------------------------------------------------------------------
    # 1) 생육 데이터 확인
    # ------------------------------------------------------------------
    recent = (summary["recent"] or {}).get("area")
    previous = (summary["previous"] or {}).get("area")
    recent_h = (summary["recent"] or {}).get("height")
    r = recent["pct_per_day"] if recent else None
    p = previous["pct_per_day"] if previous else None
    h_rate = recent_h["per_day"] if recent_h else None

    slowing = r is not None and p is not None and p > 0 and r < p * (1 - t["slowdown_ratio"] / 100)
    stagnant = r is not None and r < t["stagnation_rate"]
    area_down = slowing or stagnant
    last_delta = series[-1]["delta"] or {}
    last_drop = last_delta.get("area_pct")
    sudden_drop = last_drop is not None and last_drop <= -t["drop_alert"]
    window_all_up = bool(recent) and all(
        (s["delta"] or {}).get("area", 0) > 0 for s in series[recent["start"] + 1: recent["end"] + 1]
    )
    area_growing = (
        r is not None and not area_down and window_all_up and (h_rate is None or h_rate >= 0)
    )

    area_reasons = []
    if r is not None:
        area_reasons.append(f"최근 {_n(recent['days'])}일 투영 면적 생장률 {_signed(r)}%/일")
    if slowing:
        drop = (1 - r / p) * 100
        area_reasons.append(f"그 전 기간({_signed(p)}%/일)보다 {_n(drop, 0)}% 느려졌어요")
    elif stagnant:
        area_reasons.append(f"정체 기준({_n(t['stagnation_rate'])}%/일)보다 낮아요")
    if h_rate is not None:
        area_reasons.append(f"높이 변화 {_signed(h_rate, 2)}{unit}/일")

    # 3D 측정이 최근에 2번 이상 있으면 부피 생장률을 우선 근거로, 정면 사진(2D)은 보조 근거로 씁니다.
    vol = volume_facts(scans, t, general, now)
    # 3D 구간(직전 3D 측정 → 마지막 3D 측정)이 최근 생장률 구간(최근 사진들)과 겹쳐야 지금 상태를 나타냅니다.
    # 마지막 3D 측정이 최근 구간의 시작 시점이거나 그보다 앞서면, 그 뒤 사진이 더 새로운 정보이므로 2D를 씁니다.
    vol_stale = bool(vol and recent and parse_time(scans[-1]["taken_at"]) <= parse_time(series[recent["start"]]["taken_at"]))
    if vol_stale:
        vol = None
    if vol:
        growth_down = vol["down"]
        growing_well = vol["growing"]
        growth_reasons = vol["reasons"] + [f"정면 사진: {x}" for x in area_reasons[:1]]
        # 두 판단이 확실히 엇갈릴 때만 (한쪽은 둔화·정체, 다른 쪽은 잘 자람)
        mismatch = (vol["down"] and area_growing) or (vol["growing"] and area_down)
    else:
        growth_down = area_down
        growing_well = area_growing
        growth_reasons = area_reasons
        mismatch = False

    facts.update({
        "area_rate": r,
        "area_rate_prev": p,
        "height_rate": h_rate,
        "slowing": slowing,
        "stagnant": stagnant,
        "growing_well": growing_well,
        "last_area_pct": last_drop,
        "growth_source": "3d" if vol else "2d",
        "volume_stale": vol_stale,
        "volume_rate": vol["rate"] if vol else None,
        "volume_rate_prev": vol["prev"] if vol else None,
        "volume_slowing": vol["slowing"] if vol else None,
        "volume_stagnant": vol["stagnant"] if vol else None,
        "growth_down": growth_down,
        "growth_mismatch": mismatch,
    })

    # ------------------------------------------------------------------
    # 2) 환경 데이터 확인 (최근 기록만 사용)
    # ------------------------------------------------------------------
    now = parse_time(now)
    cutoff = now - timedelta(days=ENV_MAX_AGE_DAYS)
    env = [e for e in env_logs if parse_time(e["at"]) >= cutoff]
    last_water = next((c for c in reversed(care_logs) if c["kind"] == "water" and parse_time(c["at"]) <= now), None)
    latest_m_at = series[-1]["taken_at"]
    obs = sorted((o for o in observations if parse_time(o["at"]) <= now), key=lambda o: parse_time(o["at"]))

    def watered_after(at):
        return bool(last_water and parse_time(last_water["at"]) >= parse_time(at))

    # 흙 상태 1) 토양 수분계 (선택)
    soil_entry = _latest(env, "soil")
    soil = soil_entry["soil"] if soil_entry else None
    soil_low_pct = soil is not None and soil < t["soil_min"] and not watered_after(soil_entry["at"])
    soil_high_pct = _persistent(_recent_values(env, "soil", lookback), lambda v: v > t["soil_max"], persist)
    # 흙 상태 2) 흙 만져 보기 (말랐음/촉촉함/젖어 있음) - 누구나 기록할 수 있는 값
    soil_obs = [o for o in obs if o.get("soil_state") in SOIL_LABELS]
    touch = soil_obs[-1] if soil_obs and days_between(soil_obs[-1]["at"], now) <= SOIL_STATE_MAX_AGE_DAYS else None
    soil_dry_touch = bool(touch and touch["soil_state"] == "dry" and not watered_after(touch["at"]))
    touch_states = [o["soil_state"] for o in soil_obs if parse_time(o["at"]) >= cutoff][-lookback:]
    soil_wet_touch = _persistent(touch_states, lambda v: v == "wet", persist)
    soil_low = soil_low_pct or soil_dry_touch
    soil_high = soil_high_pct or soil_wet_touch
    # 마지막 급수 뒤에 흙이 아직 촉촉하거나 젖어 있다고 기록했는지 (그러면 물 줄 때가 아님)
    moist_after_water = bool(touch and touch["soil_state"] in ("moist", "wet") and not watered_after(touch["at"]))

    # 급수 기록표 지표
    wf = water_facts(care_logs, obs, t, now)
    wf_public = {k: v for k, v in wf.items() if k != "last_log"}
    water_text = (f"마지막 급수 {_n(wf['days_since'], 1)}일 전 (물주기 확인 간격 {_n(t['water_interval_days'], 0)}일)"
                  if wf["count"] else "급수 기록이 없어요")

    # 식물 특이사항: 최근 sign_max_age_days 안에 기록한 것을 모두 씁니다.
    sign_age = general.get("sign_max_age_days", 3)
    sign_at = {}
    for o in obs:
        if days_between(o["at"], now) <= sign_age:
            for s in o.get("signs") or []:
                if s in SIGN_LABELS:
                    sign_at[s] = o["at"]
    signs = set(sign_at)

    def sign_reason(code):
        return f"{_when(sign_at[code], now)} 기록한 특이사항: {SIGN_LABELS[code]}"

    lux_vals = _recent_values(env, "lux", lookback)
    light_low = _persistent(lux_vals, lambda v: v < t["lux_min"], persist)
    temp_vals = _recent_values(env, "temp", lookback)
    temp_high = _persistent(temp_vals, lambda v: v > t["temp_max"], persist)
    temp_low = _persistent(temp_vals, lambda v: v < t["temp_min"], persist)
    hum_vals = _recent_values(env, "humidity", lookback)
    hum_high = _persistent(hum_vals, lambda v: v > t["humidity_max"], persist)
    hum_low = _persistent(hum_vals, lambda v: v < t["humidity_min"], persist)
    has_env = any(e.get(k) is not None for e in env for k in ("temp", "humidity", "soil", "lux"))

    facts.update({
        "soil": soil, "soil_low": soil_low, "soil_high": soil_high,
        "soil_state": touch["soil_state"] if touch else None,
        "light_low": light_low, "temp_high": temp_high, "temp_low": temp_low,
        "humidity_high": hum_high, "humidity_low": hum_low, "has_env": has_env,
        "signs": sorted(signs), "water": wf_public,
    })
    wilt, yellow, leggy = "wilt" in signs, "yellow" in signs, "leggy" in signs
    recently_watered = wf["days_since"] is not None and wf["days_since"] <= 1
    # 흙이 마르지 않았다는 근거 (시들어도 물 부족이 아닐 수 있음)
    not_dry = recently_watered or soil_high or moist_after_water or (
        soil is not None and soil >= t["soil_min"] and not watered_after(soil_entry["at"]))
    dry_reasons = []
    if soil_low_pct:
        dry_reasons.append(f"토양 수분 {_n(soil)}% (기준 {_n(t['soil_min'])}% 미만)")
    if soil_dry_touch:
        dry_reasons.append(f"{_when(touch['at'], now)} 흙을 만져 보니 말랐어요")
    # 과습 근거: 흙이 계속 젖어 있음, 물을 너무 자주 줌, 흙이 젖어 있을 때 또 줌
    over_reasons = []
    if soil_high_pct:
        over_reasons.append(f"최근 토양 수분 기록 중 {persist}회 이상 {_n(t['soil_max'])}% 초과")
    if soil_wet_touch:
        over_reasons.append(f"최근 흙 상태 기록 중 {persist}회 이상 '젖어 있음'")
    if wf["frequent"]:
        over_reasons.append(f"최근 급수 간격 중앙값 {_n(wf['interval_median'])}일 "
                            f"(기준 {_n(wf['frequent_days'])}일보다 자주)")
    if wf["wet_waterings"]:
        over_reasons.append(f"최근 급수 {wf['recent_n']}번 중 {wf['wet_waterings']}번은 흙이 젖어 있을 때 줬어요")
    if wf["moist_waterings"] >= 2:
        over_reasons.append(f"최근 급수 {wf['recent_n']}번 중 {wf['moist_waterings']}번은 흙이 아직 촉촉할 때 줬어요")
    # 과습이라고 하기엔 약한 근거 (관찰만): 촉촉할 때 한 번 줌
    weak_over = [] if wf["moist_waterings"] >= 2 or not wf["moist_waterings"] else [
        f"최근 급수 {wf['recent_n']}번 중 1번은 흙이 아직 촉촉할 때 줬어요"]
    # 잎 색 (사진: 조명 색을 맞춘 색상각·노란 비율·진하기 + 특이사항 '잎이 노래짐'·'잎 색이 연해짐')
    color = leaf_color_facts(series, t, now)
    shape = shape_facts(series, t, now)
    facts["leaf_color"] = color
    facts["shape"] = shape
    color_now = bool(color and color["compared"] and not color["stale"])  # 마지막 사진이 일주일 안일 때만 추천에 써요
    measured_yellow = color_now and color["yellowing"]
    measured_pale = color_now and color["paling"]
    pale_sign = "pale" in signs
    yellowing = yellow or measured_yellow
    paling = (pale_sign or measured_pale) and not yellowing
    stretching = bool(shape and shape["stretching"] and not shape["stale"])
    yellow_reasons = ([sign_reason("yellow")] if yellow else []) + (color["reasons"] if measured_yellow else [])
    pale_reasons = ([sign_reason("pale")] if pale_sign else []) + (color["reasons"] if measured_pale else [])
    color_reasons = yellow_reasons if yellowing else pale_reasons if paling else []
    color_word = "노래지고" if yellowing else "옅어지고"

    def done_since_measurement(kind):
        """마지막 촬영 이후에 이미 그 관리 행동을 했는지 (피드백 단계)."""
        return any(c["kind"] == kind and parse_time(c["at"]) >= parse_time(latest_m_at) for c in care_logs)

    # ------------------------------------------------------------------
    # 3) 조건 비교 -> 상태 판단 -> 관리 행동 추천
    #    어떤 조건에서 어떤 추천을 낼지는 규칙 파일(rules.md, 또는 앱에서 고친 규칙)이 정해요.
    #    여기서는 규칙에서 쓸 '사실'(참/거짓), '값'(글 속 숫자), '근거 문장'만 계산해요.
    # ------------------------------------------------------------------
    watered_since_wilt = wilt and watered_after(sign_at["wilt"])
    soil_known = soil is not None or touch is not None
    light_changed = done_since_measurement("light") or done_since_measurement("move")
    shape_reasons = shape["reasons"] if stretching else []
    lux_text = f"최근 조도 {', '.join(_n(v, 0) for v in lux_vals)} lux (기준 {_n(t['lux_min'], 0)} lux)"
    temp_text = f"최근 온도 {', '.join(_n(v) for v in temp_vals)}℃"
    hum_text = (f"최근 습도 {', '.join(_n(v, 0) for v in hum_vals)}% "
                f"(기준 {_n(t['humidity_min'], 0)}~{_n(t['humidity_max'], 0)}%)")
    env_issues, tips = [], []
    if temp_high:
        env_issues.append(f"온도가 높아요 ({temp_text}, 기준 {_n(t['temp_max'])}℃ 이하)")
        if t.get("label") == "상추":
            tips.append("상추는 기온이 높으면 꽃대가 올라오는 '추대'가 생기기 쉬워요.")
        tips.append("LED와 거리를 두거나 챔버를 환기해 주세요.")
    if temp_low:
        env_issues.append(f"온도가 낮아요 ({temp_text}, 기준 {_n(t['temp_min'])}℃ 이상)")
        if t.get("label") == "바질":
            tips.append("바질은 따뜻한 곳(20~30℃)을 좋아해서 추우면 생장이 크게 느려져요.")
    if hum_high:
        env_issues.append(f"습도가 높아요 (최근 {', '.join(_n(v, 0) for v in hum_vals)}%, 기준 {_n(t['humidity_max'], 0)}% 이하)")
        tips.append("습도가 높으면 곰팡이가 생기기 쉬우니 환기해 주세요.")
    if hum_low:
        env_issues.append(f"습도가 낮아요 (최근 {', '.join(_n(v, 0) for v in hum_vals)}%, 기준 {_n(t['humidity_min'], 0)}% 이상)")
        tips.append("공기가 건조하면 잎 끝이 마를 수 있어요.")
    missing = []
    if not wf["count"]:
        missing.append("물 준 날짜와 양")
    if soil is None and touch is None:
        missing.append("흙 상태")
    if not has_env:
        missing.append("온도·습도 같은 환경")
    # 비료 기록 (잎 색 규칙)
    ferts = [c for c in care_logs if c["kind"] == "fertilize" and parse_time(c["at"]) <= now]
    last_fert = ferts[-1] if ferts else None
    fert_days = days_between(last_fert["at"], now) if last_fert else None
    tracked_days = days_between(series[0]["taken_at"], now)
    # 잎 색 변화가 보인 사진(최근 2장 중 앞의 것) 또는 특이사항 기록 뒤에 비료를 줬으면 → 효과 확인
    change_from = series[-2]["taken_at"] if (measured_yellow or measured_pale) else (
        sign_at.get("yellow") or sign_at.get("pale"))
    fert_after = bool(last_fert and change_from and parse_time(last_fert["at"]) >= parse_time(change_from))
    where = (color or {}).get("where")
    color_line = ([f"잎 색 큰 변화 없음 (색상각 {_n(color['base_hue'])}° → {_n(color['hue'])}°)"]
                  if color_now else [])
    keep_reasons = list(growth_reasons) + [
        "최근 환경 기록이 모두 기준 범위 안이에요" if has_env else "환경 기록이 없어 생육 데이터만으로 판단했어요"]
    if wf["count_7d"]:
        amount = f" · 총 {_n(wf['amount_7d'], 0)}ml" if wf["amount_7d"] else ""
        keep_reasons.append(f"최근 7일 물 {wf['count_7d']}회{amount}")
    keep_reasons += color_line

    rule_facts = {
        "생장감소": growth_down, "잘자람": growing_well, "급감": sudden_drop, "생장률없음": r is None,
        "판단엇갈림": mismatch, "3D판단": bool(vol), "3D부피증가": bool(vol and vol["growing"]),
        "흙마름": soil_low, "흙젖음지속": soil_high, "흙안마름": not_dry, "흙상태앎": soil_known,
        "촬영후물줌": done_since_measurement("water"), "시든뒤물줌": watered_since_wilt,
        "최근물줌": recently_watered, "물준뒤촉촉": moist_after_water,
        "토양수분정상기록": soil is not None and not soil_low_pct,
        "급수기록있음": bool(wf["count"]),
        "물확인간격지남": bool(wf["count"]) and wf["days_since"] >= t["water_interval_days"],
        "과습의심": bool(over_reasons), "물자주줌": wf["frequent"], "젖은흙급수": bool(wf["wet_waterings"]),
        "촉촉흙급수2회": wf["moist_waterings"] >= 2, "촉촉흙급수1회": bool(weak_over),
        "시듦": wilt, "특이_노래짐": yellow, "특이_연해짐": pale_sign,
        "사진_노래짐": measured_yellow, "사진_옅어짐": measured_pale,
        "잎노래짐": yellowing, "잎옅어짐": paling,
        "잎색회복": bool(color_now and color["greening"]), "잎색비교됨": color_now,
        "아래잎노랑": where == "low", "위잎노랑": where == "high",
        "노란잎조금": ((color or {}).get("yellow") or 0) < 15,
        "웃자람": leggy, "길쭉해짐": stretching, "꽃대": "bolting" in signs, "잎끝마름": "tip_dry" in signs,
        "병해충": "pest" in signs, "빽빽함": "crowded" in signs,
        "조도낮음": light_low, "조도기록있음": bool(lux_vals), "빛바꿈": light_changed,
        "고온": temp_high, "저온": temp_low, "습도높음": hum_high, "습도낮음": hum_low,
        "습도기록있음": bool(hum_vals), "환경기록있음": has_env, "온습도문제": bool(env_issues),
        "최근비료": fert_days is not None and fert_days <= FERTILIZER_LOOKBACK_DAYS,
        "비료후변화": fert_after,
        "비료오래안줌": fert_days is None or fert_days >= general.get("nutrient_check_days", 21),
        "최근14일비료조명": done_since_days(care_logs, "fertilize", now, 14) or done_since_days(care_logs, "light", now, 14),
        "기록14일이상": tracked_days >= 14, "빠진기록있음": bool(missing),
        "바질": t.get("label") == "바질", "상추": t.get("label") == "상추",
        "기타": t.get("label") not in ("바질", "상추"),
    }
    rule_values = {
        "물준지일": _n(wf["days_since"], 0) if wf["count"] else "",
        "최저온도": _n(t["temp_min"]),
        "비료기록": "비료를 준 기록이 없어요" if fert_days is None else f"마지막 비료가 {_n(fert_days, 0)}일 전이에요",
        "잎색변화": color_word,
        "환경팁": " ".join(dict.fromkeys(tips)),
        "빠진기록": ", ".join(missing),
        "식물종류": t.get("label") or "",
    }

    def sign_list(code):
        return [sign_reason(code)] if code in signs else []

    rule_reasons = {
        "생장근거": growth_reasons,
        "급감근거": ([f"직전 기록 대비 투영 면적 {_signed(last_drop)}% (기준 -{_n(t['drop_alert'])}%)"]
                  if last_drop is not None else []),
        "흙마름근거": dry_reasons,
        "시듦근거": sign_list("wilt"),
        "과습근거": over_reasons,
        "약한과습근거": weak_over,
        "급수근거": [water_text],
        "흙상태근거": ([f"{_when(touch['at'], now)} 흙 상태: {SOIL_LABELS[touch['soil_state']]}"]
                   if moist_after_water else []),
        "토양수분근거": [f"토양 수분 {_n(soil)}%"] if soil is not None else [],
        "고온근거": [f"{temp_text} (기준 {_n(t['temp_max'])}℃ 이하)"] if temp_vals else [],
        "저온근거": [f"{temp_text} (기준 {_n(t['temp_min'])}℃ 이상)"] if temp_vals else [],
        "조도근거": [lux_text] if lux_vals else [],
        "습도근거": [hum_text] if hum_vals else [],
        "온습도문제근거": env_issues,
        "웃자람근거": sign_list("leggy"),
        "모양근거": shape_reasons,
        "노래짐근거": yellow_reasons,
        "옅어짐근거": pale_reasons,
        "잎색근거": color_reasons,
        "잎색회복근거": color["reasons"] if color_now and color["greening"] else [],
        "꽃대근거": sign_list("bolting"),
        "잎끝마름근거": sign_list("tip_dry"),
        "병해충근거": sign_list("pest"),
        "빽빽함근거": sign_list("crowded"),
        "비료근거": [f"{_when(last_fert['at'], now)} 비료를 줬어요"] if last_fert else [],
        "3D엇갈림근거": (vol["reasons"] + [f"정면 사진: {x}" for x in area_reasons[:2]]) if vol else [],
        "유지근거": keep_reasons,
        "변동근거": growth_reasons + color_line,
    }
    facts["rule_facts"] = sorted(k for k, v in rule_facts.items() if v)  # 지금 참인 사실 (규칙 미리 보기용)
    if rules is None:
        rules = rules_mod.load()
    recs = []
    for rec in rules_mod.apply(rules, rule_facts, rule_values, rule_reasons):
        kind = rec["action"]
        rec["action"] = {"kind": kind, "label": ACTION_LABELS[kind]} if kind else None
        recs.append(rec)
    if not recs:  # 규칙을 모두 꺼도 화면이 비지 않게
        recs.append(_rec("no_rule", "info", "맞는 규칙이 없어요",
                         "추천 규칙에서 지금 상황에 맞는 규칙을 찾지 못했어요. 설정 → 추천 규칙에서 확인해 주세요."))

    recs.sort(key=lambda x: -LEVEL_RANK[x["level"]])
    top = max(LEVEL_RANK[x["level"]] for x in recs)
    status = {3: "care", 2: "observe", 1: "good"}.get(top, "pending")
    return _result(status, recs, facts, summary)


def _result(status, recs, facts, summary):
    return {
        "status": status,
        "status_label": STATUS_LABELS[status],
        "headline": recs[0]["title"] if recs else "",
        "recs": recs,
        "facts": facts,
        "summary": summary,
    }
