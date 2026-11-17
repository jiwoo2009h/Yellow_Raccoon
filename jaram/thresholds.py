"""관리 추천 알고리즘의 기준값(임계값).

관리 행동 추천 규칙에 쓰는 기준값(온도·습도·토양 수분·조도, 생장 판단, 공통 판단 기준)은
이 파일이 '유일한 출처'입니다. 개발자만 정할 수 있고, 앱 이용자는 [설정 > 추천 기준]에서 확인만 합니다.
계획서 4단계에 따라 실험(바질 2개, 상추 2개)에서 모은 데이터를 보고
이 파일의 숫자를 고친 뒤 서버를 다시 시작하면 모든 식물의 추천에 반영됩니다.

예외: 식물 영역 색상(HSV) 범위는 추천 규칙이 아니라 사진 분석 설정이라 이용자가 앱에서 바꿀 수 있습니다
(USER_EDITABLE_KEYS). 바꾼 값은 DB(settings 테이블)에 저장되고, 이 파일의 값은 '기본값으로 되돌리기'에 쓰입니다.
"""

from copy import deepcopy

# 식물 종류와 무관하게 쓰는 공통 기준
GENERAL_DEFAULTS = {
    # 생장률을 계산할 때 묶는 측정 간격 수.
    # 2 이면 '최근 생장률 = 최근 3장(2구간)의 처음과 끝을 비교한 값'
    "rate_window": 2,
    # 최근 몇 번의 환경 기록을 볼지
    "env_lookback": 3,
    # 그중 몇 번 이상 기준을 벗어나야 '지속적으로 벗어남'으로 볼지
    "persist_count": 2,
}

# 종류별 기준. 단위: 온도 ℃, 습도 %, 토양 수분 %, 조도 lux
SPECIES_DEFAULTS = {
    "basil": {
        "label": "바질",
        "temp_min": 18,
        "temp_max": 30,
        "humidity_min": 40,
        "humidity_max": 70,
        "soil_min": 30,
        "soil_max": 80,
        "lux_min": 8000,
        # 최근 생장률이 이전보다 이 비율(%) 이상 줄면 '생장 둔화'
        "slowdown_ratio": 50,
        # 투영 면적 생장률(%/일)이 이 값보다 낮으면 '정체'
        "stagnation_rate": 1.0,
        # 한 번의 측정 사이에 투영 면적이 이 비율(%) 이상 줄면 '급감'
        "drop_alert": 15,
        # 토양 수분 데이터가 없을 때, 마지막 물주기 후 며칠이 지나면 확인을 권할지
        "water_interval_days": 3,
        # 잎 평균 색상(Hue)이 처음 기록보다 이만큼 낮아지면(노란 쪽) 알림
        "hue_drop": 6,
        # 식물 영역을 찾는 HSV 범위 (OpenCV 기준: H 0~179, S/V 0~255)
        "hsv_lower": [30, 40, 35],
        "hsv_upper": [90, 255, 255],
    },
    "lettuce": {
        "label": "상추",
        "temp_min": 15,
        "temp_max": 24,
        "humidity_min": 50,
        "humidity_max": 80,
        "soil_min": 40,
        "soil_max": 85,
        "lux_min": 5000,
        "slowdown_ratio": 50,
        "stagnation_rate": 1.0,
        "drop_alert": 15,
        "water_interval_days": 2,
        "hue_drop": 6,
        # 상추는 바질보다 밝은 연두색이라 H 하한을 조금 낮춤
        "hsv_lower": [25, 35, 40],
        "hsv_upper": [90, 255, 255],
    },
    "other": {
        "label": "기타",
        "temp_min": 15,
        "temp_max": 30,
        "humidity_min": 40,
        "humidity_max": 80,
        "soil_min": 30,
        "soil_max": 85,
        "lux_min": 5000,
        "slowdown_ratio": 50,
        "stagnation_rate": 1.0,
        "drop_alert": 15,
        "water_interval_days": 3,
        "hue_drop": 6,
        "hsv_lower": [28, 35, 35],
        "hsv_upper": [90, 255, 255],
    },
}

SPECIES_KEYS = tuple(SPECIES_DEFAULTS.keys())

# 이용자가 앱에서 바꿀 수 있는 항목(종류별). 나머지는 모두 추천 규칙이라 개발자만 바꿉니다.
USER_EDITABLE_KEYS = ("hsv_lower", "hsv_upper")


def default_thresholds():
    return {"general": deepcopy(GENERAL_DEFAULTS), "species": deepcopy(SPECIES_DEFAULTS)}


def apply_user_settings(stored):
    """기본값(추천 규칙) 위에 이용자가 저장한 항목 중 USER_EDITABLE_KEYS 만 덮어씁니다.
    DB에 추천 규칙 값이 남아 있어도(예전 버전 등) 무시합니다."""
    merged = default_thresholds()
    user = merge_thresholds(stored)
    for key, values in merged["species"].items():
        for k in USER_EDITABLE_KEYS:
            values[k] = user["species"][key][k]
    return merged


def locked_changes(requested):
    """요청에 추천 규칙(개발자 전용) 값을 바꾸려는 내용이 있으면 그 항목 이름 목록을 돌려줍니다."""
    asked = merge_thresholds(requested)
    base = default_thresholds()
    changed = [f"general.{k}" for k in base["general"] if asked["general"][k] != base["general"][k]]
    for sp, values in base["species"].items():
        changed += [f"{sp}.{k}" for k in values
                    if k not in USER_EDITABLE_KEYS and k != "label" and asked["species"][sp][k] != values[k]]
    return changed


def merge_thresholds(stored):
    """저장된 값을 기본값 위에 덮어씁니다. 새로 추가된 항목은 기본값으로 채워집니다."""
    merged = default_thresholds()
    if not isinstance(stored, dict):
        return merged
    for key, value in (stored.get("general") or {}).items():
        if key in merged["general"]:
            merged["general"][key] = _coerce(merged["general"][key], value)
    for species, values in (stored.get("species") or {}).items():
        if species not in merged["species"] or not isinstance(values, dict):
            continue
        target = merged["species"][species]
        for key, value in values.items():
            if key in target and key != "label":
                target[key] = _coerce(target[key], value)
    return merged


def _coerce(default, value):
    """기본값과 같은 자료형으로 바꿉니다. 바꿀 수 없으면 기본값을 유지합니다."""
    try:
        if isinstance(default, list):
            if not isinstance(value, (list, tuple)) or len(value) != len(default):
                return default
            return [int(round(float(v))) for v in value]
        if isinstance(default, bool):
            return bool(value)
        if isinstance(default, int):
            return int(round(float(value)))
        if isinstance(default, float):
            return float(value)
    except (TypeError, ValueError):
        return default
    return value
