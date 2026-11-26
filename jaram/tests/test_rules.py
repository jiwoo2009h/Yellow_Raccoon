"""행동 추천 규칙 파일(rules.md): 읽기·검사·적용·앱에서 고치기."""

from datetime import datetime, timedelta

import pytest

import recommend
import rules as R
from growth import with_units
from thresholds import GENERAL_DEFAULTS, SPECIES_DEFAULTS

START = datetime(2026, 10, 1, 9, 0)
NOW = START + timedelta(days=12)
H = {"X-Requested-With": "jaram"}
GROWING = [1000, 1200, 1440, 1730, 2070, 2490]


def series(areas=GROWING):
    ms = [{"id": i + 1, "taken_at": (START + timedelta(days=2 * i)).isoformat(), "height_px": 100 + 5 * i,
           "width_px": 100, "area_px": a, "hue": 40} for i, a in enumerate(areas)]
    return with_units(ms)


def run(rules=None, obs=(), env=(), care=()):
    return recommend.evaluate(series(), list(env), list(care), SPECIES_DEFAULTS["basil"], GENERAL_DEFAULTS, NOW,
                              observations=list(obs), rules=rules)


def errors_of(text):
    with pytest.raises(R.RuleError) as exc:
        R.parse_rules(text)
    return exc.value.errors


RULE = """## 지금처럼 (keep)
- 조건: 잘자람
- 단계: 정상
- 제목: 잘 자라요
- 내용: 그대로 두세요.
"""


def test_default_rules_file_is_valid_and_complete():
    rules = R.load()
    assert len(rules) >= 40
    codes = {r.code for r in rules}
    for code in ("water_needed", "overwater", "wilt_wet", "light_low", "stretching", "env_check", "slowing",
                 "nutrient", "leaf_color", "keep", "fluctuating"):
        assert code in codes
    assert R.check(R.default_text())["ok"]


def test_every_fact_is_computed_by_the_recommender(monkeypatch):
    seen = {}
    real = R.apply

    def spy(rules, facts, values, reasons, generated=None):
        seen.update(facts=facts, values=values, reasons=reasons, generated=generated)
        return real(rules, facts, values, reasons, generated)

    monkeypatch.setattr(R, "apply", spy)
    run()
    assert set(seen["facts"]) == set(R.FACTS)
    assert set(seen["values"]) == set(R.VALUES)
    assert set(seen["reasons"]) == set(R.REASONS)
    assert set(seen["generated"]) == set(R.GENERATED)


def test_condition_language():
    tree = R.parse_condition("흙마름 그리고 (생장감소 또는 시듦) 그리고 아님 추천:overwater")
    state = {"facts": {"흙마름": True, "시듦": True}, "values": {}, "recs": [], "explained": False}
    assert R._eval(tree, state) is True
    state["recs"].append({"code": "overwater", "level": "care"})
    assert R._eval(tree, state) is False
    assert R._eval(R.parse_condition("관리추천:overwater"), state) is True
    assert R._eval(R.parse_condition("관리추천:keep 또는 추천없음"), state) is False


def test_mistakes_are_reported_with_line_numbers():
    errs = errors_of(RULE.replace("잘자람", "잘자라"))
    assert errs[0]["line"] == 2 and "모르는 이름 '잘자라'" in errs[0]["message"] and "잘자람" in errs[0]["message"]
    assert "닫는 괄호" in errors_of(RULE.replace("잘자람", "(잘자람 또는 시듦"))[0]["message"]
    assert "관리·관찰·정상·참고" in errors_of(RULE.replace("단계: 정상", "단계: 좋음"))[0]["message"]
    assert "모르는 값 이름" in errors_of(RULE.replace("그대로 두세요.", "{온도} 그대로"))[0]["message"]
    assert "모르는 근거 이름" in errors_of(RULE + "- 근거: 생장이유\n")[0]["message"]
    assert "'조건' 이 없어요" in errors_of(RULE.replace("- 조건: 잘자람\n", ""))[0]["message"]
    assert "모르는 항목" in errors_of(RULE + "- 색깔: 초록\n")[0]["message"]
    assert errors_of("# 제목만 있음\n")[0]["message"].startswith("규칙이 하나도 없어요")


def test_text_choices_values_and_continued_lines():
    text = """## 물 (water_needed)
- 조건: 항상
- 단계: [시듦 ? 관리 | 관찰]
- 제목: 물 준 지 {물준지일}일
- 내용: [시듦 ? 시들었어요. | 잘 자라 ? 아님 | 괜찮아요.]
  흙을 만져 보세요.
- 근거: [시듦 ? 시듦근거], 급수근거
- 행동: 물주기
"""
    errs = errors_of(text)  # '잘 자라' 는 모르는 이름
    assert "모르는 이름 '잘'" in errs[0]["message"]
    rules = R.parse_rules(text.replace("| 잘 자라 ? 아님 ", ""))
    recs = R.apply(rules, {"시듦": False}, {"물준지일": "3"}, {"급수근거": ["마지막 급수 3일 전"], "시듦근거": ["x"]})
    assert recs[0]["level"] == "observe" and recs[0]["title"] == "물 준 지 3일"
    assert recs[0]["body"] == "괜찮아요. 흙을 만져 보세요." and recs[0]["reasons"] == ["마지막 급수 3일 전"]
    assert recs[0]["action"] == "water"


def test_groups_merge_and_explained():
    text = """## 첫째 (a)
- 묶음: 물
- 조건: 항상
- 단계: 관리
- 제목: A
- 내용: a
- 생장 감소 설명: 예

## 둘째 (b)
- 묶음: 물
- 조건: 항상
- 단계: 관리
- 제목: B
- 내용: b

## 근거만 더하기 (c)
- 조건: 추천:a
- 근거: 생장근거
- 근거 더하기: a

## 원인 모름 (d)
- 조건: 아님 원인설명됨
- 단계: 관찰
- 제목: D
- 내용: d
"""
    recs = R.apply(R.parse_rules(text), {}, {}, {"생장근거": ["면적 +3%/일"]})
    assert [r["code"] for r in recs] == ["a"]  # 같은 묶음은 하나만, 근거 더하기는 새 추천을 만들지 않아요
    assert recs[0]["reasons"] == ["면적 +3%/일"]


def test_editing_the_rule_text_changes_the_recommendation():
    base = run()
    assert [r["code"] for r in base["recs"]] == ["keep"]
    edited = R.default_text().replace("- 제목: 지금처럼 관리해 주세요", "- 제목: 아주 잘 자라고 있어요")
    assert run(R.load(edited))["recs"][0]["title"] == "아주 잘 자라고 있어요"
    # 시들었고 흙이 말랐을 때: 기본은 물 부족(관리), 그 규칙을 끄면 같은 묶음의 다음 규칙이 나와요
    dry_wilt = [{"at": (NOW - timedelta(hours=2)).isoformat(), "soil_state": "dry", "signs": ["wilt"], "care_id": None}]
    assert run(obs=dry_wilt)["recs"][0]["code"] == "water_needed"
    off = R.default_text().replace("""## 물 부족 (water_needed)
- 묶음: 흙마름""", """## 물 부족 (water_needed)
- 사용: 아니오
- 묶음: 흙마름""")
    codes = [r["code"] for r in run(R.load(off), obs=dry_wilt)["recs"]]
    assert "soil_low_watch" in codes and codes.count("water_needed") <= 1


def test_all_rules_off_still_shows_something():
    text = RULE.replace("- 조건: 잘자람", "- 조건: 잘자람\n- 사용: 아니오")
    res = run(R.load(text))
    assert res["recs"][0]["code"] == "no_rule" and res["status"] == "pending"


# ---------------------------------------------------------------- 앱에서 고치기
def make_plant(client):
    pid = client.post("/api/plants", json={"name": "바질 1"}, headers=H).get_json()["id"]
    import io
    import cv2
    from seed_demo import draw_plant
    for i, size in enumerate((0.3, 0.45)):
        ok, buf = cv2.imencode(".jpg", draw_plant(size, "basil", seed=3))
        client.post(f"/api/plants/{pid}/measurements",
                    data={"photo": (io.BytesIO(buf.tobytes()), "a.jpg"), "taken_at": f"2026-11-0{i + 1}T09:00"},
                    content_type="multipart/form-data", headers=H)
    return pid


def test_rules_api_check_preview_but_no_save(client):
    pid = make_plant(client)
    got = client.get("/api/rules").get_json()
    assert got["custom"] is False and got["locked"] is True and got["check"]["ok"] and got["text"] == R.default_text()
    assert any(f["name"] == "흙마름" for f in got["reference"]["facts"])
    assert any(g["name"] == "특이사항" for g in got["reference"]["generated"])

    bad = client.post("/api/rules/check", json={"text": RULE.replace("잘자람", "없는이름")}, headers=H).get_json()
    assert not bad["ok"] and bad["errors"][0]["line"] == 2

    new_text = """## 늘 보이는 규칙 (always)
- 조건: 항상
- 단계: 관찰
- 제목: 규칙 파일에서 왔어요
- 내용: 식물 종류는 {식물종류}예요.
"""
    prev = client.post("/api/rules/preview", json={"text": new_text, "plant_id": pid}, headers=H).get_json()
    assert prev["recs"][0]["title"] == "규칙 파일에서 왔어요" and prev["recs"][0]["body"] == "식물 종류는 바질예요."
    assert isinstance(prev["true_facts"], list)
    # 미리 보기는 저장하지 않아요
    assert client.get(f"/api/plants/{pid}").get_json()["recs"][0]["code"] != "always"

    # 관리 추천 규칙은 개발자만 rules.md 에서 바꿔요. 앱에서 저장하려 하면 거절해요.
    res = client.put("/api/rules", json={"text": new_text}, headers=H)
    assert res.status_code == 403 and "rules.md" in res.get_json()["error"]
    assert client.get(f"/api/plants/{pid}").get_json()["recs"][0]["code"] != "always"
    assert client.post("/api/rules/reset", headers=H).get_json()["custom"] is False


def test_old_saved_account_rules_are_ignored(tmp_path):
    import db
    from app import create_app

    app = create_app(tmp_path / "data", password="가입코드123")
    a = app.test_client()
    a.post("/api/signup", json={"username": "희승", "password": "secret12", "code": "가입코드123"}, headers=H)
    uid = a.get("/api/auth").get_json()["user"]["id"]
    pid = make_plant(a)
    c = db.connect(str(tmp_path / "data" / "jaram.db"))
    db.set_setting(c, f"rules:{uid}", RULE.replace("잘 자라요", "예전에 저장한 규칙"))
    c.commit()
    c.close()
    got = a.get("/api/rules").get_json()
    assert got["custom"] is False and got["text"] == R.default_text()
    recs = a.get(f"/api/plants/{pid}").get_json()["recs"]
    assert all("예전에 저장한 규칙" not in r["title"] for r in recs)
    assert a.post("/api/rules/check", json={"text": RULE}).status_code == 403  # 앱 헤더 없이 쓰기 금지
