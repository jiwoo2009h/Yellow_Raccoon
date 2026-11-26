"""계정 모드(서버에 팀 비밀번호 = 가입 코드가 있을 때): 가입·로그인·자기 식물만 보기."""

import io
import zipfile

import cv2
import pytest

from seed_demo import draw_plant

H = {"X-Requested-With": "jaram"}
CODE = "바질상추2026"


@pytest.fixture()
def app_locked(tmp_path):
    from app import create_app

    app = create_app(tmp_path / "data", password=CODE)
    app.config["TESTING"] = True
    return app


@pytest.fixture()
def locked(app_locked):
    return app_locked.test_client()


def signup(client, username="희승", password="secret12", code=CODE):
    return client.post("/api/signup", json={"username": username, "password": password, "code": code}, headers=H)


def login(client, username="희승", password="secret12"):
    return client.post("/api/login", json={"username": username, "password": password}, headers=H)


def photo():
    ok, buf = cv2.imencode(".jpg", draw_plant(0.4))
    return io.BytesIO(buf.tobytes())


def test_no_password_means_open(client):
    assert client.get("/api/auth").get_json() == {"required": False, "authenticated": True, "user": None}
    assert client.get("/api/plants").status_code == 200


def test_api_and_media_need_login(locked):
    assert locked.get("/api/auth").get_json() == {"required": True, "authenticated": False, "user": None}
    assert locked.get("/api/plants").status_code == 401
    assert locked.get("/media/1/x.jpg").status_code == 401
    assert locked.get("/api/export.csv").status_code == 401
    assert locked.get("/api/backup.zip").status_code == 401
    # 화면 파일은 공개 (기록 없음)
    assert locked.get("/").status_code == 200


def test_signup_needs_the_team_code(locked):
    assert signup(locked, code="틀린코드").status_code == 403
    assert signup(locked, code="").status_code == 403
    assert signup(locked, username="a").status_code == 400  # 아이디 2자 이상
    assert signup(locked, username="나쁜 아이디!").status_code == 400
    assert signup(locked, password="123").status_code == 400  # 비밀번호 6자 이상
    res = signup(locked)
    assert res.status_code == 201
    assert res.get_json()["user"] == {"id": 1, "username": "희승", "is_admin": True}  # 첫 가입자 = 관리자
    assert locked.get("/api/auth").get_json()["user"]["username"] == "희승"
    assert signup(locked, username="희승").status_code == 409  # 같은 아이디


def test_login_logout_and_wrong_password(app_locked):
    c = app_locked.test_client()
    signup(c)
    assert c.post("/api/logout", headers=H).status_code == 200
    assert c.get("/api/plants").status_code == 401
    assert login(c, password="틀림틀림").status_code == 401
    assert login(c, username="없는사람").status_code == 401
    assert login(c, username="").status_code == 400
    assert login(c).status_code == 200
    assert c.get("/api/plants").status_code == 200
    assert c.post("/api/plants", json={"name": "바질 1"}, headers=H).status_code == 201


def test_old_team_password_screen_is_told_to_refresh(locked):
    res = locked.post("/api/login", json={"password": CODE}, headers=H)  # 예전 화면이 보내는 요청
    assert res.status_code == 409 and "새로고침" in res.get_json()["error"]


def test_writes_without_app_header_are_blocked(locked):
    signup(locked)
    assert locked.post("/api/plants", json={"name": "바질 1"}).status_code == 403
    assert locked.post("/api/login", json={"username": "희승", "password": "secret12"}).status_code == 403
    assert locked.post("/api/signup", json={"username": "x2", "password": "secret12", "code": CODE}).status_code == 403


def test_too_many_failures_are_throttled(app_locked):
    c = app_locked.test_client()
    signup(c)
    c.post("/api/logout", headers=H)
    for _ in range(10):
        login(c, password="xxxxxx")
    assert login(c).status_code == 429  # 맞는 비밀번호도 잠시 막힘
    # 가입 코드를 계속 틀려도 같이 잠겨요
    assert signup(c, username="새사람", code="x").status_code == 429


def test_each_user_sees_only_their_own_plants(app_locked):
    a, b = app_locked.test_client(), app_locked.test_client()
    signup(a, "희승")
    signup(b, "민수", "pass1234")
    pa = a.post("/api/plants", json={"name": "바질 1", "code": "B1"}, headers=H).get_json()["id"]
    pb = b.post("/api/plants", json={"name": "상추 1", "code": "L1", "species": "lettuce"}, headers=H).get_json()["id"]
    assert [p["name"] for p in a.get("/api/plants").get_json()["plants"]] == ["바질 1"]
    assert [p["name"] for p in b.get("/api/plants").get_json()["plants"]] == ["상추 1"]

    # 사진·관리·환경·상태 기록
    m = a.post(f"/api/plants/{pa}/measurements", data={"photo": (photo(), "a.jpg")},
               content_type="multipart/form-data", headers=H).get_json()["measurement"]
    care = a.post(f"/api/plants/{pa}/care", json={"kind": "water", "amount": 100}, headers=H).get_json()["care_logs"][0]
    env = a.post(f"/api/plants/{pa}/env", json={"temp": 23}, headers=H).get_json()["env_logs"][0]
    obs = a.post(f"/api/plants/{pa}/observations", json={"signs": ["wilt"]}, headers=H).get_json()["observations"][0]

    # 민수는 희승의 식물·기록·사진을 볼 수도, 바꿀 수도, 지울 수도 없어요
    assert b.get(f"/api/plants/{pa}").status_code == 404
    assert b.patch(f"/api/plants/{pa}", json={"name": "x"}, headers=H).status_code == 404
    assert b.delete(f"/api/plants/{pa}", headers=H).status_code == 404
    assert b.get(f"/api/measurements/{m['id']}").status_code == 404
    assert b.patch(f"/api/measurements/{m['id']}", json={"note": "x"}, headers=H).status_code == 404
    assert b.delete(f"/api/measurements/{m['id']}", headers=H).status_code == 404
    assert b.get(m["photo_url"]).status_code == 404
    assert a.get(m["photo_url"]).status_code == 200
    assert b.post(f"/api/plants/{pa}/measurements", data={"photo": (photo(), "b.jpg")},
                  content_type="multipart/form-data", headers=H).status_code == 404
    assert b.post(f"/api/plants/{pa}/care", json={"kind": "water"}, headers=H).status_code == 404
    assert b.delete(f"/api/care/{care['id']}", headers=H).status_code == 404
    assert b.delete(f"/api/env/{env['id']}", headers=H).status_code == 404
    assert b.delete(f"/api/observations/{obs['id']}", headers=H).status_code == 404
    assert b.post(f"/api/plants/{pa}/reanalyze", headers=H).status_code == 404
    assert b.post(f"/api/plants/{pa}/scans", json={}, headers=H).status_code == 404
    # 그대로 남아 있어요
    detail = a.get(f"/api/plants/{pa}").get_json()
    assert len(detail["measurements"]) == 1 and len(detail["care_logs"]) == 1 and len(detail["observations"]) == 1

    # 3D 측정도 주인만
    sid = a.post(f"/api/plants/{pa}/scans", json={}, headers=H).get_json()["id"]
    assert b.get(f"/api/scans/{sid}").status_code == 404
    assert b.delete(f"/api/scans/{sid}", headers=H).status_code == 404
    assert a.get(f"/api/scans/{sid}").status_code == 200

    # 리포트·CSV·효과 검증·다시 분석은 자기 식물만
    assert [p["name"] for p in b.get("/api/report").get_json()["plants"]] == ["상추 1"]
    assert "바질 1" not in b.get("/api/export.csv").data.decode("utf-8-sig")
    assert "바질 1" in a.get("/api/export.csv").data.decode("utf-8-sig")
    assert b.get("/api/validation").get_json()["summary"]["plants"] == 1
    assert b.post("/api/reanalyze", headers=H).get_json() == {"ok": 0, "failed": 0}
    # '같은 챔버의 다른 식물에도' 환경 기록은 내 식물에만
    b.post(f"/api/plants/{pb}/env", json={"temp": 25, "apply_all": True}, headers=H)
    assert all(e["temp"] != 25 for e in a.get(f"/api/plants/{pa}").get_json()["env_logs"])


def test_first_user_takes_plants_made_before_accounts(tmp_path):
    from app import create_app

    old = create_app(tmp_path / "data")  # 계정 도입 전 (로그인 없이 쓰던 서버)
    old.test_client().post("/api/plants", json={"name": "옛 바질"})
    app = create_app(tmp_path / "data", password=CODE)
    first, second = app.test_client(), app.test_client()
    res = signup(first, "관리자")
    assert res.get_json()["claimed"] == 1
    signup(second, "팀원")
    assert [p["name"] for p in first.get("/api/plants").get_json()["plants"]] == ["옛 바질"]
    assert second.get("/api/plants").get_json()["plants"] == []
    assert second.get("/api/auth").get_json()["user"]["is_admin"] is False


def test_thresholds_are_per_user(app_locked):
    a, b = app_locked.test_client(), app_locked.test_client()
    signup(a, "희승")
    signup(b, "민수", "pass1234")
    # 관리 추천 기준값은 잠겨 있고, 사진 분석 색상(HSV) 범위만 사람마다 따로 저장돼요.
    th = a.get("/api/settings").get_json()["thresholds"]
    default_hsv = list(th["species"]["basil"]["hsv_lower"])
    th["species"]["basil"]["soil_min"] = 22
    assert a.put("/api/settings", json={"thresholds": th}, headers=H).status_code == 403
    th["species"]["basil"]["soil_min"] = 30
    th["species"]["basil"]["hsv_lower"] = [31, 40, 35]
    assert a.put("/api/settings", json={"thresholds": th}, headers=H).status_code == 200
    assert a.get("/api/settings").get_json()["thresholds"]["species"]["basil"]["hsv_lower"] == [31, 40, 35]
    assert b.get("/api/settings").get_json()["thresholds"]["species"]["basil"]["hsv_lower"] == default_hsv
    reset = a.post("/api/settings/reset", headers=H).get_json()["thresholds"]
    assert reset["species"]["basil"]["hsv_lower"] == default_hsv


def test_admin_tools_and_password_change(app_locked):
    admin, member = app_locked.test_client(), app_locked.test_client()
    signup(admin, "관리자")
    signup(member, "팀원", "pass1234")
    users = admin.get("/api/users").get_json()["users"]
    assert [(u["username"], u["is_admin"]) for u in users] == [("관리자", True), ("팀원", False)]
    assert member.get("/api/users").status_code == 403
    assert member.post("/api/users/1/reset", headers=H).status_code == 403
    temp = admin.post(f"/api/users/{users[1]['id']}/reset", headers=H).get_json()["temp_password"]
    member.post("/api/logout", headers=H)
    assert login(member, "팀원", "pass1234").status_code == 401
    assert login(member, "팀원", temp).status_code == 200
    assert member.post("/api/account/password", json={"current": "틀림", "new": "newpass1"}, headers=H).status_code == 403
    assert member.post("/api/account/password", json={"current": temp, "new": "123"}, headers=H).status_code == 400
    assert member.post("/api/account/password", json={"current": temp, "new": "newpass1"}, headers=H).status_code == 200
    member.post("/api/logout", headers=H)
    assert login(member, "팀원", "newpass1").status_code == 200


def test_backup_is_admin_only(app_locked):
    admin, member = app_locked.test_client(), app_locked.test_client()
    signup(admin, "관리자")
    signup(member, "팀원", "pass1234")
    assert member.get("/api/backup.zip").status_code == 403
    res = admin.get("/api/backup.zip")
    assert res.status_code == 200
    res.close()


def test_backup_zip_contains_db_and_photos(client):
    pid = client.post("/api/plants", json={"name": "바질 1", "code": "B1"}).get_json()["id"]
    client.post(f"/api/plants/{pid}/measurements", data={"photo": (photo(), "a.jpg")},
                content_type="multipart/form-data")
    res = client.get("/api/backup.zip")
    assert res.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(res.data))
    names = z.namelist()
    assert "jaram.db" in names
    assert sum(n.startswith("uploads/") for n in names) == 3  # 사진·마스크·분석 이미지
    res.close()
