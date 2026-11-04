import io
import zipfile

import cv2
import pytest

from seed_demo import draw_plant

H = {"X-Requested-With": "jaram"}


@pytest.fixture()
def locked(tmp_path):
    from app import create_app

    app = create_app(tmp_path / "data", password="바질상추2026")
    app.config["TESTING"] = True
    return app.test_client()


def login(client, pw="바질상추2026"):
    return client.post("/api/login", json={"password": pw}, headers=H)


def test_no_password_means_open(client):
    assert client.get("/api/auth").get_json() == {"required": False, "authenticated": True}
    assert client.get("/api/plants").status_code == 200


def test_api_and_media_need_login(locked):
    assert locked.get("/api/auth").get_json() == {"required": True, "authenticated": False}
    assert locked.get("/api/plants").status_code == 401
    assert locked.get("/media/1/x.jpg").status_code == 401
    assert locked.get("/api/export.csv").status_code == 401
    assert locked.get("/api/backup.zip").status_code == 401
    # 화면 파일은 공개 (기록 없음)
    assert locked.get("/").status_code == 200


def test_wrong_password_rejected(locked):
    res = login(locked, "틀린비번")
    assert res.status_code == 401
    assert locked.get("/api/plants").status_code == 401


def test_login_then_use_and_logout(locked):
    assert login(locked).status_code == 200
    assert locked.get("/api/auth").get_json()["authenticated"] is True
    assert locked.get("/api/plants").status_code == 200
    res = locked.post("/api/plants", json={"name": "바질 1"}, headers=H)
    assert res.status_code == 201
    assert locked.post("/api/logout", headers=H).status_code == 200
    assert locked.get("/api/plants").status_code == 401


def test_writes_without_app_header_are_blocked(locked):
    login(locked)
    assert locked.post("/api/plants", json={"name": "바질 1"}).status_code == 403
    assert locked.post("/api/login", json={"password": "바질상추2026"}).status_code == 403


def test_too_many_failures_are_throttled(locked):
    for _ in range(10):
        login(locked, "x")
    res = login(locked)  # 맞는 비밀번호도 잠시 막힘
    assert res.status_code == 429


def test_backup_zip_contains_db_and_photos(client):
    pid = client.post("/api/plants", json={"name": "바질 1", "code": "B1"}).get_json()["id"]
    ok, buf = cv2.imencode(".jpg", draw_plant(0.4))
    client.post(f"/api/plants/{pid}/measurements", data={"photo": (io.BytesIO(buf.tobytes()), "a.jpg")},
                content_type="multipart/form-data")
    res = client.get("/api/backup.zip")
    assert res.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(res.data))
    names = z.namelist()
    assert "jaram.db" in names
    assert sum(n.startswith("uploads/") for n in names) == 3  # 사진·마스크·분석 이미지
    res.close()
