"""생육 지표의 변화량과 생장률 계산.

계획서 2-라 의 공식을 그대로 씁니다.
  변화량 = X2 - X1
  생장률 = (X2 - X1) / (t2 - t1)         (단위: 하루당)
식물마다 크기가 달라 비교가 어렵기 때문에 상대 생장률(%/일)도 함께 계산합니다.
  상대 생장률 = (X2 - X1) / X1 × 100 / (t2 - t1)
"""

from datetime import datetime

MIN_DAYS = 1 / 24  # 1시간보다 짧은 간격은 생장률을 계산하지 않습니다.
SCAN_MIN_DAYS = 0.5  # 3D 측정은 손촬영 오차가 커서 반나절보다 짧은 간격은 부피 생장률을 내지 않습니다.


def parse_time(value):
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def days_between(a, b):
    return (parse_time(b) - parse_time(a)).total_seconds() / 86400


def pct_change(before, after):
    if before is None or after is None or before <= 0:
        return None
    return (after - before) / before * 100


def with_units(measurements, cm_per_px=None):
    """픽셀 값에 보정값을 적용해 height/width/area 를 만들고, 직전 기록과의 변화를 붙입니다.

    보정값(cm_per_px)이 없으면 픽셀 단위 그대로 씁니다. 상대 변화(%)는 단위와 무관합니다.
    """
    k = cm_per_px if cm_per_px and cm_per_px > 0 else None
    out = []
    prev = None
    for m in measurements:
        e = dict(m)
        e["height"] = m["height_px"] * k if k else float(m["height_px"])
        e["width"] = m["width_px"] * k if k else float(m["width_px"])
        e["area"] = m["area_px"] * k * k if k else float(m["area_px"])
        e["delta"] = None
        if prev is not None:
            days = days_between(prev["taken_at"], e["taken_at"])
            delta = {
                "days": days,
                "height": e["height"] - prev["height"],
                "width": e["width"] - prev["width"],
                "area": e["area"] - prev["area"],
                "height_pct": pct_change(prev["height"], e["height"]),
                "width_pct": pct_change(prev["width"], e["width"]),
                "area_pct": pct_change(prev["area"], e["area"]),
                "area_pct_per_day": None,
                "height_per_day": None,
            }
            if days >= MIN_DAYS:
                if delta["area_pct"] is not None:
                    delta["area_pct_per_day"] = delta["area_pct"] / days
                delta["height_per_day"] = delta["height"] / days
            e["delta"] = delta
        out.append(e)
        prev = e
    return out


def window_rate(series, end, window, key):
    """series[end] 와 그보다 window 칸 앞 기록을 비교한 생장률."""
    if end < 1 or end >= len(series):
        return None
    start = max(0, end - window)
    a, b = series[start], series[end]
    days = days_between(a["taken_at"], b["taken_at"])
    if days < MIN_DAYS:
        return None
    change = b[key] - a[key]
    pct = pct_change(a[key], b[key])
    return {
        "start": start,
        "end": end,
        "days": days,
        "change": change,
        "per_day": change / days,
        "pct": pct,
        "pct_per_day": pct / days if pct is not None else None,
    }


def summarize(series, window=2):
    """최근 생장률, 그 이전 생장률, 처음 대비 전체 변화를 요약합니다."""
    n = len(series)
    summary = {"count": n, "unit": None, "recent": None, "previous": None, "total": None}
    if n == 0:
        return summary
    window = max(1, int(window))
    last = n - 1
    prev_end = last - window
    summary["recent"] = {
        "area": window_rate(series, last, window, "area"),
        "height": window_rate(series, last, window, "height"),
        "width": window_rate(series, last, window, "width"),
    }
    if prev_end >= 1:
        summary["previous"] = {
            "area": window_rate(series, prev_end, window, "area"),
            "height": window_rate(series, prev_end, window, "height"),
            "width": window_rate(series, prev_end, window, "width"),
        }
    if n >= 2:
        first, latest = series[0], series[-1]
        days = days_between(first["taken_at"], latest["taken_at"])
        area_pct = pct_change(first["area"], latest["area"])
        summary["total"] = {
            "days": days,
            "height": latest["height"] - first["height"],
            "width": latest["width"] - first["width"],
            "area": latest["area"] - first["area"],
            "height_pct": pct_change(first["height"], latest["height"]),
            "area_pct": area_pct,
            "area_pct_per_day": area_pct / days if area_pct is not None and days >= MIN_DAYS else None,
        }
    return summary


def compound_rate(v1, v2, days):
    """하루 평균 복리 생장률(%/일) = ((V2/V1)^(1/일수) − 1) × 100

    3D 측정은 보통 1주 간격이라 그 사이 몇 배씩 커지기도 합니다. 이때 '늘어난 % ÷ 일수'는
    어린 식물의 정상적인 생장도 점점 느려지는 것처럼 보이게 하므로, 하루하루 같은 비율로
    커졌다고 보고 계산합니다(식물 생장 분석의 상대 생장률 RGR과 같은 개념).
    """
    if not v1 or v1 <= 0 or v2 is None or v2 <= 0 or days < SCAN_MIN_DAYS:
        return None
    return ((v2 / v1) ** (1 / days) - 1) * 100


def scan_series(scans, cm_per_px=None):
    """3D 측정(부피 등)을 cm 단위로 바꾸고 직전 측정과의 변화·부피 생장률(%/일)을 붙입니다.

    부피는 길이의 세제곱이라 보정값도 세제곱(cm³), 위에서 본 면적은 제곱(cm²)으로 환산합니다.
    부피 생장률은 compound_rate()의 하루 평균 복리 생장률입니다.
    """
    k = cm_per_px if cm_per_px and cm_per_px > 0 else None
    out = []
    prev = None
    for s in scans:
        e = dict(s)
        e["volume"] = s["volume_px"] * k ** 3 if k else float(s["volume_px"])
        for key in ("height", "width", "depth"):
            v = s.get(f"{key}_px")
            e[key] = (v * k if k else float(v)) if v is not None else None
        ta = s.get("top_area_px")
        e["top_area"] = (ta * k * k if k else float(ta)) if ta is not None else None
        e["delta"] = None
        if prev is not None:
            days = days_between(prev["taken_at"], e["taken_at"])
            pct = pct_change(prev["volume"], e["volume"])
            e["delta"] = {
                "days": days,
                "volume": e["volume"] - prev["volume"],
                "volume_pct": pct,
                "volume_pct_per_day": compound_rate(prev["volume"], e["volume"], days),
            }
        out.append(e)
        prev = e
    return out
