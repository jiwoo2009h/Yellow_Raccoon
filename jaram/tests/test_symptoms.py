"""특이 사항 규칙 (사진 기록의 특이 사항 글 → 증상 키워드 → 병해충). test_DG 브랜치에서 옮겨 왔어요."""
from datetime import datetime, timedelta

import rules as R
from growth import with_units
from recommend import evaluate
from symptoms import find_symptoms
from thresholds import GENERAL_DEFAULTS, SPECIES_DEFAULTS

START = datetime(2026, 10, 1, 9, 0)
NOW = START + timedelta(days=12)
GROWING = [1000, 1200, 1440, 1730, 2070, 2490]  # 약 10%/일
SLOWING = [1000, 1200, 1440, 1730, 1760, 1780]  # 마지막 구간에서 거의 멈춤


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


def run(series, env=(), care=(), species="basil", rules=None):
    return evaluate(series, list(env), list(care), SPECIES_DEFAULTS[species], GENERAL_DEFAULTS, NOW, rules=rules)


def codes(result):
    return [r["code"] for r in result["recs"]]

def with_notes(series, notes):
    """notes: {측정 순번: 특이 사항 글}"""
    for i, text in notes.items():
        series[i]["note"] = text
    return series


def rec(result, code):
    return next(r for r in result["recs"] if r["code"] == code)


def note_codes(result):
    return [c for c in codes(result) if c.startswith("note_")]


def noted(text, species="lettuce", env=(), care=(), areas=GROWING):
    return run(with_notes(series_from(areas), {len(areas) - 1: text}), env, care, species)


def test_symptom_keywords_and_negation():
    found, negated = find_symptoms("잎 뒷면에 하얀 곰팡이, 반점은 없음")
    assert "underside_mold" in found and "white_mold" not in found  # 뒷면 곰팡이가 흰 곰팡이를 포함
    assert "spot" not in found and "spot" in negated


def test_symptom_combination_points_to_pest():
    assert note_codes(noted("갈색 반점에 겹무늬가 있음"))[0] == "note_cercospora"
    assert note_codes(noted("밑동이 물러지고 냄새가 남"))[0] == "note_soft_rot"
    assert note_codes(noted("썩은 부분에 검은 알갱이"))[0] == "note_sclerotinia"
    assert note_codes(noted("잎에 구불구불한 하얀 줄"))[0] == "note_leafminer"
    assert note_codes(noted("잎에 반짝이는 점액 자국이 있고 구멍"))[0] == "note_slug"
    assert note_codes(noted("잎에 흰 가루", "basil"))[0] == "note_powdery_mildew"


def test_strong_combination_is_care_and_single_feature_is_observe():
    assert rec(noted("밑동이 물러지고 냄새가 남"), "note_soft_rot")["level"] == "care"
    assert rec(noted("잎 뒷면에 하얀 곰팡이"), "note_downy_mildew")["level"] == "observe"


def test_env_support_raises_level_and_is_explained():
    humid = [env_at(10, humidity=88), env_at(11, humidity=90)]
    r = rec(noted("잎 뒷면에 하얀 곰팡이", env=humid), "note_downy_mildew")
    assert r["level"] == "care"
    assert any("노균병이 잘 생기는 환경" in x for x in r["reasons"])


def test_similar_candidates_are_grouped_with_check_tips():
    r = noted("잎에 갈색 반점이 생김")
    assert len(note_codes(r)) == 1
    body = r["recs"][0]["body"]
    assert "구분하려면" in body and "겹무늬" in body


def test_unrelated_problems_get_separate_recs():
    assert set(note_codes(noted("진딧물 있고 잎에 구멍"))) == {"note_aphid", "note_caterpillar"}


def test_single_symptom_gives_related_pests():
    r = noted("잎에 변색이 생김")
    assert note_codes(r) == ["note_symptom_watch"]
    w = rec(r, "note_symptom_watch")
    assert w["level"] == "observe" and "관련 있는 병해충" in w["body"]
    assert noted("잎이 노랗게 변함")["status"] == "observe"


def test_note_on_first_photo_counts():
    r = run(with_notes(series_from([1000]), {0: "잎이 끈적하고 새순에 작은 벌레"}))
    assert r["status"] == "care" and codes(r)[0] == "note_aphid" and "baseline" in codes(r)


def test_note_cleared_by_newer_note():
    s = with_notes(series_from(GROWING), {4: "갈색 반점에 겹무늬", 5: "이상 없음"})
    assert note_codes(run(s)) == []
    s = with_notes(series_from(GROWING), {4: "갈색 반점에 겹무늬", 5: "반점 없어짐"})
    assert note_codes(run(s)) == []


def test_collapse_uses_env_to_narrow_cause():
    dark = [env_at(10, lux=1500), env_at(11, lux=1800)]
    r = noted("모종이 쓰러짐", env=dark)
    assert note_codes(r) == ["note_collapse"] and "빛 부족" in rec(r, "note_collapse")["body"]
    assert note_codes(noted("밑동이 잘록하게 가늘어지고 쓰러짐"))[0] == "note_damping_off"


def test_note_feedback_after_action():
    care = [{"at": (START + timedelta(days=11)).isoformat(), "kind": "prune", "amount": None}]
    assert "note_powdery_mildew_done" in codes(noted("흰 가루가 잎에 묻어 있음", care=care))


def test_specific_symptom_replaces_broader_one():
    found, _ = find_symptoms("잎이 암갈색으로 변하고 겹무늬 반점")
    assert {"dark_brown", "ring_spot"} <= set(found)
    assert not {"brown", "discolor", "spot"} & set(found)  # 상위 증상은 따로 표시하지 않음
    found, _ = find_symptoms("애벌레가 새잎을 갉아먹음")
    assert "larva" in found and "insect" not in found and "small_insects" not in found


def test_broad_symptom_scores_through_specific_word():
    # '노랗게' 는 '변색 1점' 인 병해충에도 맞지만, 같은 줄기에서는 한 번만 셉니다.
    from symptoms import PESTS_BY_CODE, _match
    m = _match(PESTS_BY_CODE["cercospora"]["symptoms"], {"dark_brown": "암갈"})
    assert set(m) == {"dark_brown"}  # brown·discolor 는 중복으로 세지 않음
    m = _match(PESTS_BY_CODE["gray_mold"]["symptoms"], {"yellow": "노랗"})
    assert set(m) == {"discolor"}


def test_mid_level_word_alone_lists_related_pests():
    r = noted("곰팡이가 폈어요")
    assert note_codes(r) == ["note_symptom_watch"]
    assert "잿빛곰팡이병" in r["recs"][0]["body"] and "노균병" in r["recs"][0]["body"]
    r = noted("벌레가 있어요")
    assert note_codes(r) == ["note_symptom_watch"] and "진딧물" in r["recs"][0]["body"]


def test_detailed_notes_point_to_one_pest():
    assert note_codes(noted("잎이 암갈색으로 마른 채로 썩었어요, 밑동"))[0] == "note_bottom_rot"
    assert note_codes(noted("연한 갈색으로 물러 썩고 흰 곰팡이"))[0] == "note_sclerotinia"
    assert note_codes(noted("잎 끝이 갈색으로 오그라들고 회색 곰팡이"))[0] == "note_gray_mold"
    assert note_codes(noted("반점 가운데가 회색이고 겹무늬"))[0] == "note_cercospora"
    assert note_codes(noted("잎 뒷면에 먼지 같은 작은 벌레", "basil"))[0] == "note_spider_mite"
    assert note_codes(noted("잎이 끈적하고 검은 그을음"))[0] == "note_aphid"
    r = noted("애벌레랑 똥이 있어요")
    assert note_codes(r) == ["note_caterpillar"] and r["recs"][0]["level"] == "care"


def test_weak_rivals_are_not_named_in_title():
    r = noted("잎이 하얗게 변하고 흰 가루")
    assert note_codes(r) == ["note_powdery_mildew"]
    assert r["recs"][0]["title"] == "흰가루병 의심"


def test_location_or_soil_words_alone_are_not_symptoms():
    assert note_codes(noted("새 잎이 났어요")) == []
    assert note_codes(noted("흙이 말랐어요")) == []
    assert note_codes(noted("흙을 말리는 중")) == []


def test_note_explains_slowdown_and_old_note_is_ignored():
    r = noted("거미줄이 보임", "basil", areas=SLOWING)
    assert "note_spider_mite" in codes(r) and "slowing" not in codes(r)
    assert rec(r, "note_spider_mite")["level"] == "care"
    old = run(with_notes(series_from(GROWING), {0: "갈색 반점에 겹무늬"}))  # 12일 전 기록, 최신 기록 아님
    assert note_codes(old) == []


# ---------------------------------------------------------------- 규칙 파일(rules.md)과의 연결
def test_note_rule_sits_in_rules_file_and_can_be_turned_off():
    text = R.default_text()
    rule = next(r for r in R.load(text) if r.code == "note_symptom")
    assert rule.generated == "특이사항"
    r = noted("밑동이 물러지고 냄새가 남")
    soft = rec(r, "note_soft_rot")
    assert soft["rule"] == rule.name and soft["action"]["kind"] == "prune"
    off = text.replace("- 코드 추천: 특이사항", "- 코드 추천: 특이사항\n- 사용: 아니오")
    r = run(with_notes(series_from(GROWING), {5: "밑동이 물러지고 냄새가 남"}), species="lettuce", rules=R.load(off))
    assert note_codes(r) == []


def test_unknown_generated_name_is_an_error():
    bad = "## 시험 (try_it)\n- 조건: 항상\n- 코드 추천: 없는추천\n"
    res = R.check(bad)
    assert not res["ok"] and "코드 추천" in res["errors"][0]["message"]
    assert R.check("## 시험 (try_it)\n- 조건: 항상\n- 코드 추천: 특이사항\n")["ok"]


def test_note_action_label_comes_from_dictionary():
    r = noted("애벌레랑 똥이 있어요")
    assert rec(r, "note_caterpillar")["action"] == {"kind": "other", "label": "벌레 잡았어요"}
