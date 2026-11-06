"""추천 효과 검증 (계획서 7단계)

과거 기록으로 "그때 이 앱이 어떤 추천을 했을지"를 다시 계산하고,
그 추천을 따랐을 때와 따르지 않았을 때 다음 측정에서 무엇이 달라졌는지 비교합니다.

방법
  1) 식물마다 사진을 찍은 각 시점 t 에서, t 까지의 기록(사진·환경·관리·3D)만으로
     recommend.evaluate() 를 다시 실행합니다. 기준값은 '지금' 설정된 값을 씁니다.
  2) 행동이 있는 추천(물주기, 빛 조정)은 t 이후 FOLLOW_DAYS(2일) 안에 같은 종류의
     관리 기록이 있으면 '따름', 없으면 '안 따름'으로 봅니다.
     (빛 부족 추천은 '조명 조정' 또는 '위치 옮김' 모두 따름으로 인정)
  3) 결과 지표 (추천 시점 → 다음 사진)
     - 생장률 변화 : 다음 구간 면적 생장률 − 직전 구간 면적 생장률 (%/일)
     - 토양 수분 변화 : 다음 사진 시점까지의 마지막 토양 수분 − 추천 시점의 토양 수분 (%p)
     - 회복 : 다음 사진에서 다시 판단했을 때 같은 추천이 사라졌고, 그 구간 면적 생장률이
              정체 기준 이상인지 (기준 비교 대상이 바뀌어 추천만 사라진 경우를 회복으로 세지 않음)
     - 3D : 추천 뒤 첫 3D 측정의 하루 평균 부피 생장률
  4) 추천 종류별로 따름/안 따름 두 무리의 평균을 비교합니다. 표본이 적으면(3개 미만) 표시합니다.
"""

from datetime import timedelta

from growth import parse_time
from recommend import evaluate

FOLLOW_DAYS = 2
MATCH = {"water": ("water",), "light": ("light", "move")}
SMALL_SAMPLE = 3


def _mean(values):
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def _soil_at(env, t, after=None):
    """t 시점까지(after 이후)의 마지막 토양 수분"""
    val = None
    for e in env:
        at = parse_time(e["at"])
        if at > t:
            break
        if e.get("soil") is not None and (after is None or at > after):
            val = e["soil"]
    return val


def replay_plant(plant, th):
    """식물 하나의 사진 시점마다 추천을 다시 계산합니다."""
    series, env, care, scans = plant["series"], plant["env"], plant["care"], plant.get("scans") or []
    species = th["species"].get(plant["species"]) or th["species"]["other"]
    points = []
    for i in range(1, len(series)):
        now = parse_time(series[i]["taken_at"])
        res = evaluate(
            series[: i + 1],
            [e for e in env if parse_time(e["at"]) <= now],
            [c for c in care if parse_time(c["at"]) <= now],
            species, th["general"], now, plant.get("unit", "px"),
            scans=[s for s in scans if parse_time(s["taken_at"]) <= now],
        )
        points.append({"index": i, "at": now, "result": res})
    return points


def plant_events(plant, th):
    series, env, care, scans = plant["series"], plant["env"], plant["care"], plant.get("scans") or []
    points = replay_plant(plant, th)
    species = th["species"].get(plant["species"]) or th["species"]["other"]
    events = []
    for k, pt in enumerate(points):
        i, now = pt["index"], pt["at"]
        nxt = points[k + 1] if k + 1 < len(points) else None
        before = (series[i].get("delta") or {}).get("area_pct_per_day")
        after = (series[i + 1].get("delta") or {}).get("area_pct_per_day") if i + 1 < len(series) else None
        next_at = parse_time(series[i + 1]["taken_at"]) if i + 1 < len(series) else None
        soil_before = _soil_at(env, now)
        soil_after = _soil_at(env, next_at, after=now) if next_at else None
        next_codes = {r["code"] for r in nxt["result"]["recs"]} if nxt else None
        scan_after = next((s for s in scans if parse_time(s["taken_at"]) > now), None)
        vol_after = (scan_after.get("delta") or {}).get("volume_pct_per_day") if scan_after else None
        for rec in pt["result"]["recs"]:
            if rec["level"] in ("info", "good"):
                continue
            action = rec["action"]["kind"] if rec.get("action") else None
            care_hit = None
            if action:
                kinds = MATCH.get(action, (action,))
                limit = now + timedelta(days=FOLLOW_DAYS)
                care_hit = next((c for c in care if c["kind"] in kinds and now < parse_time(c["at"]) <= limit), None)
            events.append({
                "plant_id": plant["id"], "plant": plant["name"], "species": plant["species"],
                "at": now.isoformat(timespec="minutes"),
                "code": rec["code"], "title": rec["title"], "level": rec["level"], "action": action,
                "followed": (care_hit is not None) if action else None,
                "care_at": care_hit["at"] if care_hit else None,
                "rate_before": before, "rate_after": after,
                "rate_change": after - before if after is not None and before is not None else None,
                "soil_before": soil_before, "soil_after": soil_after,
                "soil_change": soil_after - soil_before if soil_after is not None and soil_before is not None else None,
                "recovered": (rec["code"] not in next_codes and (after is None or after >= species["stagnation_rate"]))
                if next_codes is not None else None,
                "volume_rate_after": vol_after,
            })
    return events, points


def _group(evs):
    rec = [e["recovered"] for e in evs if e["recovered"] is not None]
    n = len(evs)
    return {
        "n": n,
        "small": n < SMALL_SAMPLE,
        "rate_change": _mean(e["rate_change"] for e in evs),
        "rate_after": _mean(e["rate_after"] for e in evs),
        "soil_change": _mean(e["soil_change"] for e in evs),
        "recovered": sum(rec) / len(rec) if rec else None,
        "recovered_n": len(rec),
        "volume_rate_after": _mean(e["volume_rate_after"] for e in evs),
    }


def validate(plants, th):
    """plants: [{id, name, species, unit, series, env, care, scans}] → 검증 리포트"""
    events, evaluations, statuses = [], 0, {"good": 0, "observe": 0, "care": 0, "pending": 0}
    for p in plants:
        evs, points = plant_events(p, th)
        events.extend(evs)
        evaluations += len(points)
        for pt in points:
            statuses[pt["result"]["status"]] = statuses.get(pt["result"]["status"], 0) + 1
    events.sort(key=lambda e: (e["at"], e["plant_id"]))

    by_code = []
    for code in dict.fromkeys(e["code"] for e in events):
        evs = [e for e in events if e["code"] == code]
        first = evs[0]
        entry = {
            "code": code, "title": first["title"], "level": first["level"], "action": first["action"],
            "count": len(evs), "all": _group(evs),
        }
        if first["action"]:
            yes = [e for e in evs if e["followed"]]
            no = [e for e in evs if not e["followed"]]
            entry.update(followed=len(yes), follow_rate=len(yes) / len(evs), yes=_group(yes), no=_group(no))
        by_code.append(entry)
    by_code.sort(key=lambda x: ({"care": 0, "observe": 1}.get(x["level"], 2), -x["count"]))

    actionable = [e for e in events if e["action"]]
    care_evs = [e for e in events if e["level"] == "care" and e["recovered"] is not None]
    return {
        "summary": {
            "plants": len(plants),
            "evaluations": evaluations,
            "statuses": statuses,
            "occurrences": len(events),
            "actionable": len(actionable),
            "followed": sum(1 for e in actionable if e["followed"]),
            "follow_rate": (sum(1 for e in actionable if e["followed"]) / len(actionable)) if actionable else None,
            "care_points": len(care_evs),
            "care_recovered": (sum(1 for e in care_evs if e["recovered"]) / len(care_evs)) if care_evs else None,
            "follow_days": FOLLOW_DAYS,
        },
        "by_code": by_code,
        "events": events,
    }


CSV_COLUMNS = [
    ("at", "추천 시점"), ("plant_id", "식물 ID"), ("plant", "식물"), ("code", "추천 코드"), ("title", "추천"),
    ("level", "단계"), ("action", "권장 행동"), ("followed", "따름"), ("care_at", "관리 시각"),
    ("rate_before", "직전 구간 면적 생장률(%/일)"), ("rate_after", "다음 구간 면적 생장률(%/일)"),
    ("rate_change", "생장률 변화(%/일)"), ("soil_before", "추천 시 토양 수분(%)"), ("soil_after", "다음 측정까지 토양 수분(%)"),
    ("soil_change", "토양 수분 변화(%p)"), ("recovered", "다음 측정에서 해소"), ("volume_rate_after", "다음 3D 부피 생장률(%/일)"),
]
