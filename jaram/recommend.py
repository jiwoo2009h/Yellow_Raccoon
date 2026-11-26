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
import symptoms as sx

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
    "prune": "잎 정리했어요",
    "other": "조치했어요",
}
SPECIES_BY_LABEL = {"바질": "basil", "상추": "lettuce"}
ENV_MAX_AGE_DAYS = 7  # 이보다 오래된 환경 기록은 판단에 쓰지 않습니다.


def _n(value, digits=1):
    """숫자를 보기 좋게: 12.0 -> '12', 12.34 -> '12.3'"""
    text = f"{value:,.{digits}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _signed(value, digits=1):
    return ("+" if value > 0 else "") + _n(value, digits)


def _rec(code, level, title, body, reasons=None, action=None, action_label=None):
    return {
        "code": code,
        "level": level,
        "title": title,
        "body": body,
        "reasons": reasons or [],
        "action": {"kind": action, "label": action_label or ACTION_LABELS[action]} if action else None,
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
        # 사진이 한 장뿐이어도 특이 사항(병해충)은 바로 판단합니다.
        env_state = _env_state(env_logs, care_logs, t, general, now)
        note_recs, _ = _note_recs(series, care_logs, t, env_state, now, False, [])
        recs = sorted(note_recs, key=lambda x: -LEVEL_RANK[x["level"]]) + [rec]
        status = {3: "care", 2: "observe"}.get(max(LEVEL_RANK[x["level"]] for x in recs), "pending")
        return _result(status, recs, facts, summary)

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
    env_state = _env_state(env_logs, care_logs, t, general, now)
    env = env_state["env"]
    last_water = env_state["last_water"]
    latest_m_at = series[-1]["taken_at"]
    soil = env_state["soil"]
    soil_low, soil_high = env_state["soil_low"], env_state["soil_high"]
    lux_vals, light_low = env_state["lux_vals"], env_state["light_low"]
    temp_vals, temp_high, temp_low = env_state["temp_vals"], env_state["temp_high"], env_state["temp_low"]
    hum_vals, hum_high, hum_low = env_state["hum_vals"], env_state["humidity_high"], env_state["humidity_low"]
    has_env = env_state["has_env"]

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

    # 규칙 J. 특이 사항(병해충·생육 이상) 키워드 -> symptoms.py 사전과 대조
    note_recs, note_explains = _note_recs(series, care_logs, t, env_state, now, growth_down, growth_reasons)
    recs.extend(note_recs)
    env_explained = env_explained or note_explains

    # 규칙 G. 생장 둔화의 원인을 환경 데이터로 설명할 수 없는 경우 -> 관찰
    if growth_down and not env_explained and not sudden_drop:
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
    return _result(status, recs, facts, summary)


def _josa(word):
    """받침이 있으면 '이', 없으면 '가'를 붙입니다. (노균병이 / 응애가)"""
    last = word[-1]
    has_final = "가" <= last <= "힣" and (ord(last) - 0xAC00) % 28 != 0
    return word + ("이" if has_final else "가")


def _env_state(env_logs, care_logs, t, general, now):
    """최근 환경 기록을 기준값과 비교한 결과."""
    lookback = general.get("env_lookback", 3)
    persist = general.get("persist_count", 2)
    now = parse_time(now)
    cutoff = now - timedelta(days=ENV_MAX_AGE_DAYS)
    env = [e for e in env_logs if parse_time(e["at"]) >= cutoff]
    last_water = next((c for c in reversed(care_logs) if c["kind"] == "water"), None)

    soil_entry = _latest(env, "soil")
    soil = soil_entry["soil"] if soil_entry else None
    watered_after_soil = bool(
        soil_entry and last_water and parse_time(last_water["at"]) >= parse_time(soil_entry["at"])
    )
    lux_vals = _recent_values(env, "lux", lookback)
    temp_vals = _recent_values(env, "temp", lookback)
    hum_vals = _recent_values(env, "humidity", lookback)
    return {
        "env": env,
        "last_water": last_water,
        "soil": soil,
        "soil_low": soil is not None and soil < t["soil_min"] and not watered_after_soil,
        "soil_high": _persistent(_recent_values(env, "soil", lookback), lambda v: v > t["soil_max"], persist),
        "lux_vals": lux_vals,
        "light_low": _persistent(lux_vals, lambda v: v < t["lux_min"], persist),
        "temp_vals": temp_vals,
        "temp_high": _persistent(temp_vals, lambda v: v > t["temp_max"], persist),
        "temp_low": _persistent(temp_vals, lambda v: v < t["temp_min"], persist),
        "hum_vals": hum_vals,
        "humidity_high": _persistent(hum_vals, lambda v: v > t["humidity_max"], persist),
        "humidity_low": _persistent(hum_vals, lambda v: v < t["humidity_min"], persist),
        "has_env": any(e.get(k) is not None for e in env for k in ("temp", "humidity", "soil", "lux")),
    }


def _note_recs(series, care_logs, t, env_state, now, growth_down, growth_reasons):
    """규칙 J. 특이 사항 규칙 (증상 → 병해충).

    IF 특이 사항에서 증상(변색·반점·물러짐·구멍 …)을 찾았고
       그 증상 조합이 어떤 병해충의 특징과 맞음
       (넓은 증상 '변색' 보다 구체적인 '암갈색'·'겹무늬' 가 더 큰 점수 → symptoms.py 증상 범위)
       (+ 그 병해충이 잘 생기는 환경이 기록으로 확인되거나 생장이 느려짐)
    THEN 가장 가능성 높은 병해충과 자료에 근거한 관리 방법을 추천하고,
         후보가 여럿이면 구분하는 특징을 함께 안내

    반환: (추천 목록, 생장 둔화를 설명했는지)
    """
    now = parse_time(now)
    cutoff = now - timedelta(days=sx.NOTE_MAX_AGE_DAYS)
    notes = [
        {"at": m["taken_at"], "text": m["note"]}
        for i, m in enumerate(series)
        if (m.get("note") or "").strip() and (i == len(series) - 1 or parse_time(m["taken_at"]) >= cutoff)
    ]
    note = sx.pick_note(notes)
    if note is None:
        return [], False
    species = SPECIES_BY_LABEL.get(t.get("label"), "other")
    groups = sx.group(sx.rank(note, species, env_state))

    quote = note["text"].strip()
    if len(quote) > 40:
        quote = quote[:40] + "…"
    day = parse_time(note["at"])
    note_reason = f"특이 사항 “{quote}” ({day.month}/{day.day} 기록)"

    if not groups:
        # 증상 하나만으로는 병해충을 정할 수 없을 때: 관련 병해충과 구분 방법을 안내 (관찰)
        related = sx.rank(note, species, env_state, min_score=1)[:4]
        if not related:
            return [], False
        labels = [sx.SYMPTOMS[c]["label"] for c in note["symptoms"]]
        body = (f"'{', '.join(labels)}' 증상만으로는 원인을 정하기 어려워요. 관련 있는 병해충: "
                + ", ".join(c["pest"]["name"] for c in related) + ". 구분하려면: "
                + " / ".join(c["pest"]["check"] for c in related if c["pest"]["check"]) + ". "
                "색, 위치(잎 앞면·뒷면, 밑동), 곰팡이·벌레·자국이 있는지 특이 사항에 더 적어 주면 더 정확하게 알려 드릴게요.")
        return [_rec("note_symptom_watch", "observe", f"{', '.join(labels)} 증상이 있어요", body,
                     [note_reason, "찾은 증상: " + ", ".join(labels),
                      "관련 병해충: " + ", ".join(f"{c['pest']['name']}({c['total']}점)" for c in related)])], False

    recs, explains = [], False
    for cands in groups:
        top = cands[0]
        pest = top["pest"]
        others = sx.close_rivals(cands)  # 점수가 비슷한 다른 후보만 '또는 …' 으로 안내
        group_codes = set().union(*(c["matched"] for c in cands)) & set(note["symptoms"])
        found_labels = [sx.SYMPTOMS[c]["label"] for c in note["symptoms"] if c in group_codes]
        reasons = [note_reason]
        if found_labels:
            reasons.append("찾은 증상: " + ", ".join(found_labels))
        for c in cands[:3]:
            extra = []
            if c["env_hits"]:
                extra.append(f"환경 +{len(c['env_hits'])}")
            if c["crop"]:
                extra.append("작물 자료 +1")
            reasons.append(f"{c['pest']['name']} {c['total']}점 ← " + ", ".join(c["hits"])
                           + (f" ({', '.join(extra)})" if extra else ""))
        reasons += [f"{sx.ENV_LABELS[e]} → {_josa(pest['name'])} 잘 생기는 환경이에요" for e in top["env_hits"]]
        if growth_down:
            reasons += growth_reasons
            explains = True

        supported = bool(top["env_hits"]) or growth_down
        level = "care" if (top["score"] >= sx.CARE_SCORE
                           or (top["score"] >= sx.SUPPORTED_SCORE and supported)) else "observe"

        if pest["kind"] == "생육 이상":
            title = "식물이 쓰러졌어요"
            body = pest["body"]
        else:
            names = [pest["name"]] + [c["pest"]["name"] for c in others]
            title = (f"{pest['name']} 의심" if not others
                     else f"{pest['name']} 또는 {others[0]['pest']['name']} 의심")
            lead = (f"기록한 증상({', '.join(found_labels)})으로 보면 " if found_labels else "")
            if others:
                body = (lead + f"{', '.join(names)} 가능성이 있어요. 가장 가능성이 높은 {pest['name']} 기준으로 안내할게요. "
                        + pest["body"] + " 구분하려면: "
                        + " / ".join(c["pest"]["check"] for c in [top, *others] if c["pest"]["check"]) + ".")
            else:
                body = lead + f"{pest['name']} 가능성이 있어요. " + pest["body"]

        # 쓰러짐: 자료의 '혼동하기 쉬운 원인'을 증상·환경 데이터로 좁혀 봅니다.
        if pest.get("causes"):
            text = sx.normalize(note["text"])
            likely = [c for c in pest["causes"]
                      if any(env_state.get(f) for f in c["facts"])
                      or any(code in note["symptoms"] for code in c["symptoms"])
                      or any(sx.keyword_state(text, k)[0] == "pos" for k in c.get("keywords", []))]
            if likely:
                body += (" 기록을 보면 " + ", ".join(c["label"] for c in likely) + " 가능성이 있어요. "
                         + " ".join(c["tip"] for c in likely))
                reasons.append("가능한 원인: " + ", ".join(c["label"] for c in likely))

        # 피드백: 특이 사항을 적은 뒤 이미 조치했으면 효과를 지켜봅니다.
        acted = pest["action"] and any(
            c["kind"] == pest["action"] and parse_time(c["at"]) >= day for c in care_logs)
        if acted:
            recs.append(_rec(f"note_{pest['code']}_done", "observe", f"{pest['name']} 조치 후 지켜보는 중이에요",
                             "다음 촬영 때 특이 사항에 증상이 그대로인지 적어 주세요. "
                             "좋아졌다면 '이상 없음'이나 '반점 없음'처럼 적으면 이 추천이 사라져요.",
                             reasons))
            continue
        if level == "care" and pest["kind"] == "병해":
            body += " " + sx.EXPERT_TIP
        recs.append(_rec(f"note_{pest['code']}", level, title, body, reasons,
                         action=pest["action"], action_label=pest.get("action_label")))
    return recs, explains


def _result(status, recs, facts, summary):
    return {
        "status": status,
        "status_label": STATUS_LABELS[status],
        "headline": recs[0]["title"] if recs else "",
        "recs": recs,
        "facts": facts,
        "summary": summary,
    }
