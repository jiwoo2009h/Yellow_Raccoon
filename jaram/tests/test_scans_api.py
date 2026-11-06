import io

from seed_demo import jpeg_bytes, plant_model, render_plant_top, render_plant_view


def make_plant(client):
    return client.post("/api/plants", json={"name": "바질 1", "code": "B1", "species": "basil"}).get_json()["id"]


def upload(client, sid, img, kind="side", angle=None):
    data = {"kind": kind, "photo": (io.BytesIO(jpeg_bytes(img)), "v.jpg")}
    if angle is not None:
        data["angle"] = str(angle)
    return client.post(f"/api/scans/{sid}/views", data=data, content_type="multipart/form-data")


def full_scan(client, pid, size, taken_at, top=True):
    parts = plant_model(size, "basil", seed=3)
    sid = client.post(f"/api/plants/{pid}/scans", json={"taken_at": taken_at}).get_json()["id"]
    assert upload(client, sid, render_plant_view(parts, "basil", 0, ruler=True), angle=0).status_code == 201
    for ang, sc, sh in ((90, 0.85, 40), (180, 1.15, -50), (270, 0.95, 20)):
        r = upload(client, sid, render_plant_view(parts, "basil", ang, scale=sc, shift=sh, neighbor=ang == 180), angle=ang)
        assert r.status_code == 201, r.get_json()
    if top:
        assert upload(client, sid, render_plant_top(parts, "basil", scale=0.8), kind="top").status_code == 201
    return sid


def test_full_scan_flow_creates_volume_and_daily_measurement(client):
    pid = make_plant(client)
    sid = full_scan(client, pid, 0.4, "2026-10-01T09:00")
    draft = client.get(f"/api/scans/{sid}").get_json()
    assert draft["status"] == "draft" and len(draft["views"]) == 5
    res = client.post(f"/api/scans/{sid}/compute")
    body = res.get_json()
    assert res.status_code == 200, body
    assert body["status"] == "done"
    assert body["volume"] > 0 and body["detail"]["method"] == "hull"
    assert body["detail"]["top"]["used"]
    assert client.get(body["points_url"]).status_code == 200
    plant = client.get(f"/api/plants/{pid}").get_json()
    assert len(plant["scans"]) == 1
    assert plant["count"] == 1, "0° 사진이 일반 측정으로도 저장됨"
    assert plant["measurements"][0]["taken_at"].startswith("2026-10-01T09:00")


def test_growth_between_scans_and_calibration(client):
    pid = make_plant(client)
    s1 = full_scan(client, pid, 0.3, "2026-10-01T09:00")
    client.post(f"/api/scans/{s1}/compute")
    s2 = full_scan(client, pid, 0.5, "2026-10-08T09:00")
    second = client.post(f"/api/scans/{s2}/compute").get_json()
    assert second["delta"]["volume_pct"] > 30
    assert second["delta"]["days"] == 7
    assert second["previous"]["id"] == s1
    px_volume = second["volume"]
    client.patch(f"/api/plants/{pid}", json={"calibration": {"x1": 845, "y1": 340, "x2": 845, "y2": 740, "length_cm": 10}})
    cm = client.get(f"/api/scans/{s2}").get_json()
    assert cm["plant"]["unit"] == "cm"
    assert abs(cm["volume"] - px_volume * 0.025 ** 3) < 1e-6 * max(1, px_volume)
    report = client.get("/api/report").get_json()
    assert len(report["plants"][0]["scans"]) == 2


def test_retake_replaces_view_and_roi_reanalysis(client):
    pid = make_plant(client)
    sid = full_scan(client, pid, 0.4, "2026-10-01T09:00", top=False)
    parts = plant_model(0.4, "basil", seed=3)
    again = upload(client, sid, render_plant_view(parts, "basil", 90, scale=1.0), angle=90).get_json()
    assert len(again["views"]) == 4
    v180 = next(v for v in again["views"] if v["angle"] == 180)
    patched = client.patch(f"/api/scans/{sid}/views/{v180['id']}", json={"roi": [0.2, 0.1, 0.8, 0.9]}).get_json()
    assert next(v for v in patched["views"] if v["angle"] == 180)["roi"] == [0.2, 0.1, 0.8, 0.9]
    assert client.patch(f"/api/scans/{sid}/views/{v180['id']}", json={"roi": [0.1, 0.1, 0.11, 0.11]}).status_code == 400


def test_compute_requires_front_and_perpendicular(client):
    pid = make_plant(client)
    parts = plant_model(0.4, "basil", seed=3)
    sid = client.post(f"/api/plants/{pid}/scans", json={}).get_json()["id"]
    upload(client, sid, render_plant_view(parts, "basil", 90), angle=90)
    assert client.post(f"/api/scans/{sid}/compute").status_code == 400
    upload(client, sid, render_plant_view(parts, "basil", 0, ruler=True), angle=0)
    upload(client, sid, render_plant_view(parts, "basil", 180), angle=180)
    v90 = next(v for v in client.get(f"/api/scans/{sid}").get_json()["views"] if v["angle"] == 90)
    client.delete(f"/api/scans/{sid}/views/{v90['id']}")
    assert client.post(f"/api/scans/{sid}/compute").status_code == 422  # 0°·180° 는 같은 방향


def test_bad_inputs(client):
    pid = make_plant(client)
    sid = client.post(f"/api/plants/{pid}/scans", json={}).get_json()["id"]
    parts = plant_model(0.4, "basil", seed=3)
    assert upload(client, sid, render_plant_view(parts, "basil", 45), angle=45).status_code == 400
    blank = render_plant_view([], "basil", 0) * 0 + 220
    assert upload(client, sid, blank, angle=0).status_code == 422


def test_new_draft_replaces_old_draft_and_delete(client):
    pid = make_plant(client)
    old = full_scan(client, pid, 0.4, "2026-10-01T09:00", top=False)
    new = client.post(f"/api/plants/{pid}/scans", json={}).get_json()["id"]
    assert client.get(f"/api/scans/{old}").status_code == 404
    sid = full_scan(client, pid, 0.4, "2026-10-02T09:00")
    done = client.post(f"/api/scans/{sid}/compute").get_json()
    photo = done["views"][0]["photo_url"]
    assert client.delete(f"/api/scans/{sid}").status_code == 200
    assert client.get(photo).status_code == 404
    assert client.get(f"/api/plants/{pid}").get_json()["count"] == 1, "측정 기록은 남음"
    assert new != sid


def test_scans_csv(client):
    pid = make_plant(client)
    sid = full_scan(client, pid, 0.4, "2026-10-01T09:00")
    client.post(f"/api/scans/{sid}/compute")
    lines = client.get("/api/export_scans.csv").data.decode("utf-8-sig").strip().splitlines()
    assert lines[0].startswith("날짜,식물ID") and len(lines) == 2


def test_recent_scans_drive_recommendation(client):
    from datetime import datetime, timedelta
    pid = make_plant(client)
    now = datetime.now().replace(microsecond=0)
    for size, ago in ((0.3, 8), (0.5, 1)):
        sid = full_scan(client, pid, size, (now - timedelta(days=ago)).isoformat(timespec="minutes"), top=False)
        assert client.post(f"/api/scans/{sid}/compute").status_code == 200
    plant = client.get(f"/api/plants/{pid}").get_json()
    assert plant["facts"]["growth_source"] == "3d"
    assert plant["facts"]["volume_rate"] > 0
    assert any("3D 부피 생장률" in reason for rec in plant["recs"] for reason in rec["reasons"])


def test_volume_threshold_validation(client):
    th = client.get("/api/settings").get_json()["thresholds"]
    th["species"]["basil"]["volume_slowdown_ratio"] = 120
    r = client.put("/api/settings", json={"thresholds": th}, headers={"X-Requested-With": "jaram"})
    assert r.status_code == 400
    th["species"]["basil"]["volume_slowdown_ratio"] = 40
    th["general"]["scan_max_age_days"] = 500
    saved = client.put("/api/settings", json={"thresholds": th}, headers={"X-Requested-With": "jaram"}).get_json()
    assert saved["thresholds"]["species"]["basil"]["volume_slowdown_ratio"] == 40
    assert saved["thresholds"]["general"]["scan_max_age_days"] == 60
