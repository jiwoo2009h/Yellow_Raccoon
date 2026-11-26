import io
from datetime import datetime, timedelta

import cv2

from seed_demo import draw_plant
from thresholds import default_thresholds


def photo(size, species="basil", seed=1):
    ok, buf = cv2.imencode(".jpg", draw_plant(size, species, seed=seed), [cv2.IMWRITE_JPEG_QUALITY, 92])
    return io.BytesIO(buf.tobytes())


def upload(client, pid, size, taken_at, species="basil"):
    return client.post(f"/api/plants/{pid}/measurements",
                       data={"taken_at": taken_at, "photo": (photo(size, species), "p.jpg")},
                       content_type="multipart/form-data")


def make_plant(client, **kw):
    body = {"name": "바질 1", "code": "B1", "species": "basil", **kw}
    res = client.post("/api/plants", json=body)
    assert res.status_code == 201
    return res.get_json()


def test_create_and_list(client):
    make_plant(client)
    plants = client.get("/api/plants").get_json()["plants"]
    assert len(plants) == 1
    assert plants[0]["species_label"] == "바질"
    assert plants[0]["status"] == "pending"


def test_validation(client):
    assert client.post("/api/plants", json={"name": ""}).status_code == 400
    assert client.post("/api/plants", json={"name": "x", "species": "cactus"}).status_code == 400


def test_measure_compare_and_calibrate(client):
    pid = make_plant(client)["id"]
    r1 = upload(client, pid, 0.3, "2026-10-01T09:00")
    assert r1.status_code == 201
    r2 = upload(client, pid, 0.5, "2026-10-03T09:00")
    body = r2.get_json()
    m = body["measurement"]
    assert body["previous"]["id"] == r1.get_json()["measurement"]["id"]
    assert m["delta"]["area_pct"] > 0
    assert m["delta"]["days"] == 2
    assert client.get(m["photo_url"]).status_code == 200
    assert client.get(m["overlay_url"]).status_code == 200

    # 자 보정 -> cm 단위
    res = client.patch(f"/api/plants/{pid}", json={"calibration": {
        "x1": 10, "y1": 0, "x2": 10, "y2": 400, "length_cm": 10}})
    plant = res.get_json()
    assert plant["unit"] == "cm"
    assert abs(plant["cm_per_px"] - 0.025) < 1e-9
    assert abs(plant["latest"]["height"] - plant["latest"]["height_px"] * 0.025) < 1e-3


def test_env_and_care_feed_recommendation(client):
    pid = make_plant(client)["id"]
    sizes = [0.3, 0.38, 0.46, 0.47, 0.475]
    for i, s in enumerate(sizes):
        # 환경 기록은 최근 7일 것만 판단에 쓰므로 오늘을 기준으로 날짜를 만듭니다.
        at = (datetime.now() - timedelta(days=8 - 2 * i)).replace(microsecond=0).isoformat()
        mid = upload(client, pid, s, at).get_json()["measurement"]["id"]
        res = client.patch(f"/api/measurements/{mid}", json={"env": {"soil": 40 - 6 * i}})
        assert res.status_code == 200
    plant = client.get(f"/api/plants/{pid}").get_json()
    assert plant["status"] == "care"
    assert plant["recs"][0]["code"] == "water_needed"
    assert plant["latest"]["env"]["soil"] == 16

    res = client.post(f"/api/plants/{pid}/care", json={"kind": "water", "amount": 150, "rec_code": "water_needed"})
    assert res.status_code == 201
    after = res.get_json()
    assert after["recs"][0]["code"] != "water_needed"
    assert after["care_logs"][-1]["kind_label"] == "물주기"


def test_upload_rejects_non_image_and_empty_scene(client):
    pid = make_plant(client)["id"]
    bad = client.post(f"/api/plants/{pid}/measurements", data={"photo": (io.BytesIO(b"xx"), "a.jpg")},
                      content_type="multipart/form-data")
    assert bad.status_code == 400
    ok, buf = cv2.imencode(".jpg", (draw_plant(0.3) * 0 + 220).astype("uint8"))
    empty = client.post(f"/api/plants/{pid}/measurements",
                        data={"photo": (io.BytesIO(buf.tobytes()), "a.jpg")}, content_type="multipart/form-data")
    assert empty.status_code == 422


def test_rules_are_locked_but_hsv_is_editable(client):
    pid = make_plant(client)["id"]
    upload(client, pid, 0.4, "2026-10-01T09:00")
    got = client.get("/api/settings").get_json()
    s = got["thresholds"]
    assert s == default_thresholds() and got["locked"] is True

    # 관리 추천 규칙(기준값)은 이용자가 바꿀 수 없어야 합니다.
    rule = {**s, "species": {**s["species"], "basil": {**s["species"]["basil"], "soil_min": 22}}}
    assert client.put("/api/settings", json={"thresholds": rule}).status_code == 403
    general = {**s, "general": {**s["general"], "persist_count": 1}}
    assert client.put("/api/settings", json={"thresholds": general}).status_code == 403
    assert client.get("/api/settings").get_json()["thresholds"]["species"]["basil"]["soil_min"] == 30

    # 식물 영역 색상(HSV) 범위는 원래처럼 바꿀 수 있어야 합니다. (정수로 저장)
    s["species"]["basil"]["hsv_lower"] = [32.4, 40, 35]
    res = client.put("/api/settings", json={"thresholds": s})
    assert res.status_code == 200
    assert res.get_json()["thresholds"]["species"]["basil"]["hsv_lower"] == [32, 40, 35]
    s["species"]["basil"]["hsv_lower"] = [95, 40, 35]
    assert client.put("/api/settings", json={"thresholds": s}).status_code == 400
    assert client.post(f"/api/plants/{pid}/reanalyze").get_json() == {"ok": 1, "failed": 0}
    reset = client.post("/api/settings/reset").get_json()["thresholds"]["species"]["basil"]["hsv_lower"]
    assert reset == default_thresholds()["species"]["basil"]["hsv_lower"]


def test_stored_rule_values_are_ignored_but_hsv_kept(tmp_path):
    import db
    from app import create_app
    create_app(tmp_path)
    c = db.connect(str(tmp_path / "jaram.db"))
    db.set_setting(c, "thresholds", {"species": {"basil": {"soil_min": 5, "hsv_lower": [31, 40, 35]}},
                                     "general": {"persist_count": 1}})
    c.commit()
    c.close()
    app = create_app(tmp_path)
    got = app.test_client().get("/api/settings").get_json()["thresholds"]
    assert got["species"]["basil"]["soil_min"] == 30
    assert got["species"]["basil"]["hsv_lower"] == [31, 40, 35]
    assert got["general"] == default_thresholds()["general"]


def test_rules_file_cannot_be_saved_from_the_app(client):
    res = client.put("/api/rules", json={"text": "## x (x)\n- 조건: 항상\n- 단계: 관찰\n- 제목: 가\n- 내용: 나\n"})
    assert res.status_code == 403
    got = client.get("/api/rules").get_json()
    assert got["locked"] is True and got["custom"] is False


def test_report_and_csv(client):
    pid = make_plant(client)["id"]
    upload(client, pid, 0.3, "2026-10-01T09:00")
    upload(client, pid, 0.4, "2026-10-02T09:00")
    report = client.get("/api/report").get_json()
    assert report["plants"][0]["points"][1]["day"] == 1
    csv = client.get("/api/export.csv").data.decode("utf-8-sig")
    lines = csv.strip().splitlines()
    assert lines[0].startswith("날짜,식물ID")
    assert len(lines) == 3


def test_delete_measurement_removes_files(client, tmp_path):
    pid = make_plant(client)["id"]
    m = upload(client, pid, 0.3, "2026-10-01T09:00").get_json()["measurement"]
    assert client.delete(f"/api/measurements/{m['id']}").status_code == 200
    assert client.get(m["photo_url"]).status_code == 404


def test_special_note_is_reflected_in_recommendation(client):
    pid = make_plant(client)["id"]
    mid = upload(client, pid, 0.3, "2026-10-01T09:00").get_json()["measurement"]["id"]
    assert client.patch(f"/api/measurements/{mid}", json={"note": "새순에 작은 벌레가 모여 있고 잎이 끈적함"}).status_code == 200
    plant = client.get(f"/api/plants/{pid}").get_json()
    assert plant["status"] == "care"
    assert any(r["code"] == "note_aphid" for r in plant["recs"])
    rules = client.get("/api/settings").get_json()["symptoms"]
    assert any(p["code"] == "aphid" for p in rules["pests"]) and any(x["code"] == "spot" for x in rules["symptoms"])
    assert client.patch(f"/api/measurements/{mid}", json={"note": "가" * 301}).status_code == 400
