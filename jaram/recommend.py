"""규칙 기반(IF -> THEN) 식물 상태 판단 및 관리 행동 추천.

계획서 3-마(4단계)의 구조를 그대로 구현합니다.
  [식물 이미지 입력 -> 생육 지표 추출 -> 환경 데이터 입력 -> 생장률 계산
   -> 조건 비교 -> 식물 상태 판단 -> 관리 행동 추천 -> 결과 표시]

원칙 (계획서 '허. 다중 조건 판단')
  - 환경값 하나만 보고 판단하지 않습니다. 항상 '생장 변화'와 '환경 변화'를 함께 봅니다.
  - 예) 토양 수분이 낮아도 잘 자라고 있으면 '물 부족'이 아니라 '관찰'로 분류합니다.
  - 모든 추천에는 판단 근거(실제 수치)를 함께 붙여서 왜 그런 추천이 나왔는지 설명합니다.

상태는 계획서 '노. 식물 상태 판단'의 세 가지로 나눕니다.
  good    = 정상 생육
  observe = 관찰 필요
  care    = 관리 필요 가능성
"""

from datetime import timedelta

from growth import days_between, parse_time, summarize

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
}
ENV_MAX_AGE_DAYS = 7  # 이보다 오래된 환경 기록은 판단에 쓰지 않습니다.
WEEK_DAYS = 7  # '최근 일주일 수치 기반 추천'에 쓰는 기간

# 식물 화면의 '오늘의 추천 행동' 문장 (추천 코드별)
TODAY = {
    "no_data": "오늘은 첫 사진을 찍어 기준 기록을 만드는 것을 추천합니다.",
    "baseline": "오늘은 같은 위치·거리에서 사진을 한 번 더 찍는 것을 추천합니다.",
    "sudden_drop": "오늘은 잎이 시들거나 상하지 않았는지 직접 확인하는 것을 추천합니다.",
    "water_needed": "오늘은 흙 상태를 확인하고 물을 주는 것을 추천합니다.",
    "water_done": "오늘은 물을 준 효과를 지켜보며 사진을 한 번 더 찍는 것을 추천합니다.",
    "soil_low_watch": "오늘은 흙이 얼마나 말랐는지 손으로 만져 확인하는 것을 추천합니다.",
    "overwater": "오늘은 물을 주지 말고 화분 배수 상태를 확인하는 것을 추천합니다.",
    "light_low": "오늘은 식물을 더 밝은 곳으로 옮기거나 LED 조명 시간을 늘리는 것을 추천합니다.",
    "light_done": "오늘은 빛 환경을 바꾼 효과를 지켜보는 것을 추천합니다.",
    "light_low_watch": "오늘은 조도를 한 번 더 재 보는 것을 추천합니다.",
    "env_check": "오늘은 챔버의 온도·습도를 권장 범위로 맞추는 것을 추천합니다.",
    "env_watch": "오늘은 챔버의 온도·습도를 한 번 더 확인하는 것을 추천합니다.",
    "water_interval": "오늘은 흙 표면을 만져 보고 말라 있으면 물을 주는 것을 추천합니다.",
    "slowing": "오늘은 같은 위치·거리에서 사진을 찍어 생장 변화를 다시 확인하는 것을 추천합니다.",
    "hue_drop": "오늘은 잎 색이 실제로 변했는지 직접 살펴보는 것을 추천합니다.",
    "yellow_leaf": "오늘은 노랗게 변한 잎이 있는지 직접 살펴보는 것을 추천합니다.",
    "keep": "오늘은 지금처럼 관리하는 것을 추천합니다.",
    "too_close": "오늘은 같은 위치·거리에서 사진을 찍어 기록을 이어가는 것을 추천합니다.",
    "fluctuating": "오늘은 같은 위치·거리에서 사진을 찍어 기록을 이어가는 것을 추천합니다.",
}


def _n(value, digits=1):
    """숫자를 보기 좋게: 12.0 -> '12', 12.34 -> '12.3'"""
    text = f"{value:,.{digits}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _josa(word, with_final, without_final):
    """받침 유무에 맞는 조사: _josa('온도', '을', '를') -> '를'"""
    ch = word.strip()[-1:]
    if "가" <= ch <= "힣":
        return with_final if (ord(ch) - 0xAC00) % 28 else without_final
    return without_final


def _signed(value, digits=1):
    return ("+" if value > 0 else "") + _n(value, digits)


def _rec(code, level, title, body, reasons=None, action=None):
    return {
        "code": code,
        "level": level,
        "title": title,
        "body": body,
        "reasons": reasons or [],
        "today": TODAY.get(code, ""),
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


def evaluate(series, env_logs, care_logs, species, general, now, unit="px"):
    """식물 하나의 상태와 추천 목록을 계산합니다.

    series    : growth.with_units() 결과 (촬영 시각 순)
    env_logs  : [{at, temp, humidity, soil, lux}, ...] (시각 순)
    care_logs : [{at, kind, amount}, ...] (시각 순)
    species   : 종류별 기준값 (thresholds.SPECIES_DEFAULTS 형태)
    general   : 공통 기준값
    """
    t = species
    weekly = weekly_advice(env_logs, care_logs, species, now)
    window = general.get("rate_window", 2)
    lookback = general.get("env_lookback", 3)
    persist = general.get("persist_count", 2)
    summary = summarize(series, window)
    n = len(series)

    facts = {"count": n, "unit": unit}
    if n == 0:
        rec = _rec("no_data", "info", "첫 사진을 찍어 주세요",
                   "사진을 한 장 찍으면 그 사진을 기준으로 생장량을 비교하기 시작해요.")
        return _result("pending", [rec], facts, summary, weekly)
    if n == 1:
        rec = _rec("baseline", "info", "기준 사진을 저장했어요",
                   "다음 촬영부터 이 사진과 비교해서 얼마나 자랐는지 알려드릴게요. "
                   "같은 위치·거리에서 찍으면 더 정확해요.")
        return _result("pending", [rec], facts, summary, weekly)

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
    growth_down = slowing or stagnant
    last_delta = series[-1]["delta"] or {}
    last_drop = last_delta.get("area_pct")
    sudden_drop = last_drop is not None and last_drop <= -t["drop_alert"]
    window_all_up = bool(recent) and all(
        (s["delta"] or {}).get("area", 0) > 0 for s in series[recent["start"] + 1: recent["end"] + 1]
    )
    growing_well = (
        r is not None and not growth_down and window_all_up and (h_rate is None or h_rate >= 0)
    )

    growth_reasons = []
    if r is not None:
        growth_reasons.append(f"최근 {_n(recent['days'])}일 투영 면적 생장률 {_signed(r)}%/일")
    if slowing:
        drop = (1 - r / p) * 100
        growth_reasons.append(f"그 전 기간({_signed(p)}%/일)보다 {_n(drop, 0)}% 느려졌어요")
    elif stagnant:
        growth_reasons.append(f"정체 기준({_n(t['stagnation_rate'])}%/일)보다 낮아요")
    if h_rate is not None:
        growth_reasons.append(f"높이 변화 {_signed(h_rate, 2)}{unit}/일")

    facts.update({
        "area_rate": r,
        "area_rate_prev": p,
        "height_rate": h_rate,
        "slowing": slowing,
        "stagnant": stagnant,
        "growing_well": growing_well,
        "last_area_pct": last_drop,
    })

    # ------------------------------------------------------------------
    # 2) 환경 데이터 확인 (최근 기록만 사용)
    # ------------------------------------------------------------------
    now = parse_time(now)
    cutoff = now - timedelta(days=ENV_MAX_AGE_DAYS)
    env = [e for e in env_logs if parse_time(e["at"]) >= cutoff]
    last_water = next((c for c in reversed(care_logs) if c["kind"] == "water"), None)
    latest_m_at = series[-1]["taken_at"]

    soil_entry = _latest(env, "soil")
    soil = soil_entry["soil"] if soil_entry else None
    watered_after_soil = bool(
        soil_entry and last_water and parse_time(last_water["at"]) >= parse_time(soil_entry["at"])
    )
    soil_low = soil is not None and soil < t["soil_min"] and not watered_after_soil
    soil_high = _persistent(_recent_values(env, "soil", lookback), lambda v: v > t["soil_max"], persist)

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
        "light_low": light_low, "temp_high": temp_high, "temp_low": temp_low,
        "humidity_high": hum_high, "humidity_low": hum_low, "has_env": has_env,
    })

    def done_since_measurement(kind):
        """마지막 촬영 이후에 이미 그 관리 행동을 했는지 (피드백 단계)."""
        return any(c["kind"] == kind and parse_time(c["at"]) >= parse_time(latest_m_at) for c in care_logs)

    recs = []
    env_explained = False

    # ------------------------------------------------------------------
    # 3) 조건 비교 -> 상태 판단 -> 관리 행동 추천
    # ------------------------------------------------------------------

    # 규칙 A. 투영 면적 급감: 시듦 또는 촬영 조건 변화(측정 오류) 가능성
    if sudden_drop:
        recs.append(_rec(
            "sudden_drop", "care" if soil_low else "observe",
            "식물 영역이 갑자기 줄었어요",
            "잎이 시들거나 상하지 않았는지 확인해 주세요. 식물이 괜찮다면 촬영 위치나 조명이 "
            "바뀌어 생긴 측정 오차일 수 있어요. 이 기록을 지우거나 다시 찍을 수 있어요.",
            [f"직전 기록 대비 투영 면적 {_signed(last_drop)}% (기준 -{_n(t['drop_alert'])}%)"],
        ))

    # 규칙 B. IF 토양 수분이 기준보다 낮고 최근 생장률도 감소 THEN 물주기 여부 확인
    if soil_low and growth_down:
        env_explained = True
        if done_since_measurement("water"):
            recs.append(_rec("water_done", "observe", "물을 준 효과를 지켜보는 중이에요",
                             "다음 촬영에서 토양 수분과 생장률이 어떻게 바뀌었는지 비교해 드릴게요."))
        else:
            recs.append(_rec(
                "water_needed", "care", "수분 부족 가능성이 있어요",
                "흙이 말라 있고 생장도 느려졌어요. 흙 상태를 확인하고 물을 주세요. "
                "물을 준 뒤 '물 줬어요'를 눌러 기록하면 효과를 비교할 수 있어요.",
                [f"토양 수분 {_n(soil)}% (기준 {_n(t['soil_min'])}% 미만)"] + growth_reasons,
                action="water",
            ))
    # 토양 수분은 낮지만 잘 자라는 중 -> 바로 물 부족으로 판단하지 않고 관찰
    elif soil_low:
        recs.append(_rec(
            "soil_low_watch", "observe", "흙이 마르고 있어요",
            "아직 생장은 괜찮아서 바로 물 부족이라고 보지는 않아요. "
            "다음 측정 때 토양 수분과 생장률을 함께 확인해 볼게요.",
            [f"토양 수분 {_n(soil)}% (기준 {_n(t['soil_min'])}% 미만)"] + growth_reasons,
        ))

    # 규칙 C. 과습: 토양 수분이 계속 높고 생장 둔화
    if soil_high and growth_down:
        env_explained = True
        recs.append(_rec(
            "overwater", "care", "과습 가능성이 있어요",
            "흙이 계속 젖어 있는데 생장이 느려졌어요. 물 주는 간격을 늘리고 화분 배수를 확인해 주세요.",
            [f"최근 토양 수분 기록 중 {persist}회 이상 {_n(t['soil_max'])}% 초과"] + growth_reasons,
        ))

    # 규칙 D. IF 조도가 일정 기간 낮고 생장률도 감소 THEN 위치 또는 조명 확인
    lux_text = f"최근 조도 {', '.join(_n(v, 0) for v in lux_vals)} lux (기준 {_n(t['lux_min'], 0)} lux)"
    if light_low and growth_down:
        env_explained = True
        if done_since_measurement("light") or done_since_measurement("move"):
            recs.append(_rec("light_done", "observe", "빛 환경을 바꾼 효과를 지켜보는 중이에요",
                             "다음 촬영에서 생장률이 회복되는지 비교해 드릴게요."))
        else:
            recs.append(_rec(
                "light_low", "care", "빛이 부족할 수 있어요",
                "조도가 계속 낮고 생장도 느려졌어요. 식물을 더 밝은 곳으로 옮기거나 "
                "LED 조명 시간·높이를 확인해 주세요.",
                [lux_text] + growth_reasons,
                action="light",
            ))
    elif light_low:
        recs.append(_rec(
            "light_low_watch", "observe", "조도가 낮은 편이에요",
            "아직 생장 지표는 늘고 있어서 바로 광량 부족으로 판단하지 않아요. 계속 지켜볼게요.",
            [lux_text] + growth_reasons,
        ))

    # 규칙 E. IF 온도·습도가 범위를 계속 벗어나고 생장 증가량 감소 THEN 환경 조건 확인
    env_issues, tips = [], []
    if temp_high:
        env_issues.append(f"온도가 높아요 (최근 {', '.join(_n(v) for v in temp_vals)}℃, 기준 {_n(t['temp_max'])}℃ 이하)")
        if t.get("label") == "상추":
            tips.append("상추는 25℃가 넘으면 꽃대가 올라오는 '추대'가 생기기 쉬워요.")
        tips.append("LED와 거리를 두거나 챔버를 환기해 주세요.")
    if temp_low:
        env_issues.append(f"온도가 낮아요 (최근 {', '.join(_n(v) for v in temp_vals)}℃, 기준 {_n(t['temp_min'])}℃ 이상)")
        if t.get("label") == "바질":
            tips.append("바질은 추위에 약해서 15℃ 아래에서는 생장이 크게 느려져요.")
    if hum_high:
        env_issues.append(f"습도가 높아요 (최근 {', '.join(_n(v, 0) for v in hum_vals)}%, 기준 {_n(t['humidity_max'], 0)}% 이하)")
        tips.append("습도가 높으면 곰팡이가 생기기 쉬우니 환기해 주세요.")
    if hum_low:
        env_issues.append(f"습도가 낮아요 (최근 {', '.join(_n(v, 0) for v in hum_vals)}%, 기준 {_n(t['humidity_min'], 0)}% 이상)")
        tips.append("공기가 건조하면 잎 끝이 마를 수 있어요.")
    if env_issues and growth_down:
        env_explained = True
        recs.append(_rec(
            "env_check", "care", "환경 조건을 확인해 주세요",
            "온도·습도가 권장 범위를 계속 벗어났고 생장도 느려졌어요. " + " ".join(dict.fromkeys(tips)),
            env_issues + growth_reasons,
        ))
    elif env_issues:
        recs.append(_rec(
            "env_watch", "observe", "온도·습도가 권장 범위 밖이에요",
            "아직 생장에는 큰 변화가 없어요. " + " ".join(dict.fromkeys(tips)),
            env_issues,
        ))

    # 규칙 F. 토양 수분 기록이 없을 때는 마지막 물주기 후 경과일로 안내
    if soil is None and last_water:
        since = days_between(last_water["at"], now)
        if since >= t["water_interval_days"]:
            env_explained = env_explained or growth_down
            recs.append(_rec(
                "water_interval", "care" if growth_down else "observe",
                f"물 준 지 {_n(since, 0)}일 지났어요",
                "흙 표면을 만져 보고 말라 있으면 물을 주세요. 토양 수분계 값을 함께 기록하면 더 정확하게 판단할 수 있어요.",
                [f"마지막 물주기 {_n(since, 1)}일 전 (기준 {_n(t['water_interval_days'], 0)}일)"] + (growth_reasons if growth_down else []),
                action="water",
            ))

    # 규칙 H-2. 노란 잎 비율 증가 (잎이 노랗게 변하면 초록 영역에서 빠지므로 따로 확인)
    # 노랗게 변한 잎은 초록 면적에서 빠지므로, 이때의 생장 둔화는 '원인 불명'으로 보지 않습니다.
    yellow_up = False
    yellows = [s["yellow_ratio"] for s in series if s.get("yellow_ratio") is not None]
    if len(yellows) >= 2:
        base_y = min(yellows[:3])
        latest_y = yellows[-1]
        facts["yellow_ratio"] = latest_y
        yellow_up = latest_y - base_y >= t.get("yellow_rise", 10)
        if yellow_up:
            recs.append(_rec(
                "yellow_leaf", "observe", "잎 색 변화",
                f"노란 잎 비율 {_n(latest_y)}% (초기 {_n(base_y)}%). 잎을 직접 살펴보세요. "
                "조명 색이 달라도 이렇게 보일 수 있어요.",
                [f"노란 잎 비율 {_n(base_y)}% → {_n(latest_y)}% (기준 +{_n(t.get('yellow_rise', 10))}%p 이상)"],
            ))

    # 규칙 G. 생장 둔화의 원인을 환경 데이터로 설명할 수 없는 경우 -> 관찰
    if growth_down and not env_explained and not sudden_drop and not yellow_up:
        body = "아직 원인이 명확하지 않아요. 다음 촬영까지 지켜볼게요."
        if not has_env:
            body += " 온도·습도·토양 수분·조도를 함께 기록하면 원인을 찾는 데 도움이 돼요."
        recs.append(_rec("slowing", "observe", "생장 속도가 줄었어요", body, growth_reasons))

    # 규칙 H. 잎 색 변화 (노란 쪽으로 Hue 감소)
    if n >= 3:
        base_hue = sum(s["hue"] for s in series[:3] if s.get("hue") is not None) / max(
            1, sum(1 for s in series[:3] if s.get("hue") is not None))
        latest_hue = series[-1].get("hue")
        if latest_hue is not None and base_hue - latest_hue >= t["hue_drop"]:
            recs.append(_rec(
                "hue_drop", "observe", "잎 색이 노란 쪽으로 변했어요",
                "먼저 조명 조건이 같았는지 확인해 주세요. 실제로 잎이 노래졌다면 과습, 빛 부족, 양분 부족을 의심해 볼 수 있어요.",
                [f"잎 평균 색상(Hue) {_n(base_hue)} → {_n(latest_hue)} (기준 {_n(t['hue_drop'])} 이상 감소)"],
            ))

    # 규칙 I. IF 환경 변화가 크지 않고 높이·투영 면적이 계속 증가 THEN 현재 관리 환경 유지
    has_problem = any(LEVEL_RANK[x["level"]] >= LEVEL_RANK["observe"] for x in recs)
    if growing_well and not has_problem:
        reasons = list(growth_reasons)
        reasons.append("최근 환경 기록이 모두 기준 범위 안이에요" if has_env
                       else "환경 기록이 없어 생육 데이터만으로 판단했어요")
        recs.append(_rec("keep", "good", "지금처럼 관리해 주세요",
                         "높이와 투영 면적이 꾸준히 늘고 있어요. 현재 관리 환경을 유지하면 돼요.", reasons))

    if not recs:
        if r is None:
            recs.append(_rec("too_close", "info", "비교하기엔 간격이 짧아요",
                             "생장률은 1시간 이상 간격을 두고 찍은 사진으로 계산해요."))
        else:
            recs.append(_rec("fluctuating", "good", "큰 이상은 없어요",
                             "측정값이 조금씩 오르내리고 있어요. 같은 위치·거리에서 찍으면 더 정확하게 비교할 수 있어요.",
                             growth_reasons))

    recs.sort(key=lambda x: -LEVEL_RANK[x["level"]])
    top = max(LEVEL_RANK[x["level"]] for x in recs)
    status = {3: "care", 2: "observe", 1: "good"}.get(top, "pending")
    return _result(status, recs, facts, summary, weekly)


def _result(status, recs, facts, summary, weekly=None):
    return {
        "status": status,
        "status_label": STATUS_LABELS[status],
        "headline": recs[0]["title"] if recs else "",
        "today": recs[0]["today"] if recs else "",
        "recs": recs,
        "facts": facts,
        "summary": summary,
        "weekly": weekly or [],
    }


# ----------------------------------------------------------------------
# 최근 일주일 수치 기반 추천
# ----------------------------------------------------------------------
# key, 이름, 단위, 최솟값 키, 최댓값 키, 소수 자리
WEEKLY_FIELDS = (
    ("temp", "온도", "℃", "temp_min", "temp_max", 1),
    ("humidity", "습도", "%", "humidity_min", "humidity_max", 0),
    ("soil", "토양 수분", "%", "soil_min", "soil_max", 0),
    ("lux", "조도", " lux", "lux_min", None, 0),
    ("light_hours", "조명 시간", "시간", "light_hours_min", None, 1),
)


def weekly_advice(env_logs, care_logs, species, now):
    """최근 7일 환경 기록의 평균을 기준 범위와 비교해 '무엇을 몇으로 맞추면 좋을지' 문장으로 만듭니다.

    생장 데이터와 함께 보는 위의 규칙(evaluate)과 달리, 환경 수치만 보는 참고용 안내입니다.
    """
    t = species
    now = parse_time(now)
    since = now - timedelta(days=WEEK_DAYS)
    env = [e for e in env_logs if since <= parse_time(e["at"]) <= now + timedelta(hours=1)]
    out = []
    for key, label, unit, lo_key, hi_key, digits in WEEKLY_FIELDS:
        vals = [e[key] for e in env if e.get(key) is not None]
        lo = t.get(lo_key)
        hi = t.get(hi_key) if hi_key else None
        if not vals or lo is None:
            continue
        avg = sum(vals) / len(vals)
        item = {"key": key, "label": label, "unit": unit.strip(), "avg": avg, "min": min(vals),
                "max": max(vals), "n": len(vals), "lo": lo, "hi": hi, "status": "ok", "target": None}
        avg_text = f"최근 일주일 평균 {label} {_n(avg, digits)}{unit}"
        if hi is not None:
            target = (lo + hi) / 2
            range_text = f"{_n(lo, digits)}~{_n(hi, digits)}{unit}"
        else:
            target = lo
            range_text = f"{_n(lo, digits)}{unit} 이상"
        if avg < lo:
            item["status"] = "low"
            item["target"] = target
            if key == "soil":
                item["text"] = f"{avg_text}로 낮아요. 물 주는 간격을 줄여 토양 수분을 {_n(target, 0)}% 정도로 맞춰 주시는 것을 추천합니다."
            elif key == "light_hours":
                item["text"] = f"{avg_text}으로 짧아요. 조명 시간을 하루 {_n(lo, 0)}시간 이상으로 늘려 주시는 것을 추천합니다."
            elif key == "lux":
                item["text"] = f"{avg_text}로 어두워요. 조도를 {_n(lo, 0)} lux 이상으로 높여 주시는 것을 추천합니다."
            else:
                item["text"] = f"{avg_text}로 낮아요. {label}{_josa(label, '을', '를')} {_n(target, 0)}{unit.strip()} 정도로 맞춰 주시는 것을 추천합니다."
        elif hi is not None and avg > hi:
            item["status"] = "high"
            item["target"] = target
            if key == "soil":
                item["text"] = f"{avg_text}로 높아요. 물 주는 간격을 늘려 토양 수분을 {_n(target, 0)}% 정도로 맞춰 주시는 것을 추천합니다."
            else:
                item["text"] = f"{avg_text}로 높아요. {label}{_josa(label, '을', '를')} {_n(target, 0)}{unit.strip()} 정도로 맞춰 주시는 것을 추천합니다."
        else:
            item["text"] = f"{avg_text} · 권장 범위({range_text}) 안이에요. 지금 {label}{_josa(label, '을', '를')} 유지하는 것을 추천합니다."
        out.append(item)

    waters = [c for c in care_logs if c["kind"] == "water" and since <= parse_time(c["at"]) <= now + timedelta(hours=1)]
    total = sum(c.get("amount") or 0 for c in waters)
    w = {"key": "water", "label": "물주기", "unit": "mL", "n": len(waters), "total": total, "status": "ok"}
    if waters:
        w["text"] = f"최근 일주일 동안 물을 {len(waters)}번" + (f", 모두 {_n(total, 0)} mL 줬어요." if total else " 줬어요.")
    else:
        w["status"] = "none"
        w["text"] = "최근 일주일 동안 물을 준 기록이 없어요. 흙 상태를 확인하고, 물을 줬다면 기록해 주세요."
    out.append(w)
    return out
