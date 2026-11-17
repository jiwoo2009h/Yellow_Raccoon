"""식물 상태 기록(흙 만져 보기·특이사항)과 급수 기록 API."""

from datetime import datetime, timedelta

import validation
from growth import with_units
from test_api import make_plant, upload
from thresholds import default_thresholds


def two_photos(client):
    p = make_plant(client)
    now = datetime.now()
    upload(client, p["id"], 1.0, (now - timedelta(days=3)).isoformat(timespec="minutes"))
    # 흙 상태는 이틀 안의 기록만 '지금 상태'로 써서, 마지막 사진은 방금 찍은 것으로
    upload(client, p["id"], 1.2, (now - timedelta(hours=1)).isoformat(timespec="minutes"))
    return p["id"]


def test_observation_api_feeds_recommendation(client):
    pid = two_photos(client)
    res = client.post(f"/api/plants/{pid}/observations", json={"signs": ["leggy", "leggy"], "note": "줄기만 길어짐"})
    assert res.status_code == 201
    data = res.get_json()
    assert len(data["observations"]) == 1
    o = data["observations"][0]
    assert o["signs"] == ["leggy"] and o["note"] == "줄기만 길어짐" and o["measurement_id"] is None
    assert "light_leggy" in [r["code"] for r in data["recs"]]
    assert data["facts"]["signs"] == ["leggy"]

    assert client.post(f"/api/plants/{pid}/observations", json={"signs": ["sunburn"]}).status_code == 400
    assert client.post(f"/api/plants/{pid}/observations", json={"soil_state": "soggy"}).status_code == 400
    assert client.post(f"/api/plants/{pid}/observations", json={}).status_code == 400

    assert client.delete(f"/api/observations/{o['id']}").get_json() == {"ok": True}
    after = client.get(f"/api/plants/{pid}").get_json()
    assert after["observations"] == [] and "light_leggy" not in [r["code"] for r in after["recs"]]


def test_water_with_soil_state_links_observation_and_cascades(client):
    pid = two_photos(client)
    res = client.post(f"/api/plants/{pid}/care", json={"kind": "water", "amount": 150, "soil_state": "wet"})
    assert res.status_code == 201
    data = res.get_json()
    care = data["care_logs"][-1]
    o = data["observations"][-1]
    assert o["care_id"] == care["id"] and o["soil_state"] == "wet" and o["at"] == care["at"]
    assert data["facts"]["water"]["count"] == 1 and data["facts"]["water"]["wet_waterings"] == 1
    assert client.post(f"/api/plants/{pid}/care", json={"kind": "water", "soil_state": "mud"}).status_code == 400
    # 조명 기록에는 흙 상태를 붙이지 않아요
    client.post(f"/api/plants/{pid}/care", json={"kind": "light", "amount": 12, "soil_state": "dry"})
    assert len(client.get(f"/api/plants/{pid}").get_json()["observations"]) == 1
    client.delete(f"/api/care/{care['id']}")
    assert client.get(f"/api/plants/{pid}").get_json()["observations"] == []


def test_photo_observation_follows_measurement(client):
    pid = two_photos(client)
    mid = client.get(f"/api/plants/{pid}").get_json()["measurements"][-1]["id"]
    r = client.patch(f"/api/measurements/{mid}", json={"observation": {"soil_state": "dry", "signs": ["wilt"]}})
    assert r.status_code == 200
    assert r.get_json()["observation"] == {"soil_state": "dry", "signs": ["wilt"], "note": None}
    plant = r.get_json()["plant"]
    assert plant["facts"]["soil_state"] == "dry" and "water_needed" in [x["code"] for x in plant["recs"]]

    new_time = (datetime.now() - timedelta(hours=3)).replace(microsecond=0, second=0)
    client.patch(f"/api/measurements/{mid}", json={"taken_at": new_time.isoformat()})
    obs = client.get(f"/api/plants/{pid}").get_json()["observations"]
    assert obs[0]["at"] == new_time.isoformat() and obs[0]["measurement_id"] == mid

    r = client.patch(f"/api/measurements/{mid}", json={"observation": {"soil_state": None, "signs": []}})
    assert r.get_json()["observation"] is None
    assert client.get(f"/api/plants/{pid}").get_json()["observations"] == []
    assert client.patch(f"/api/measurements/{mid}", json={"observation": {"signs": "wilt"}}).status_code == 400


def test_settings_validate_frequent_watering_interval(client):
    th = client.get("/api/settings").get_json()["thresholds"]
    assert th["species"]["basil"]["water_frequent_days"] == 1.5 and th["general"]["sign_max_age_days"] == 3
    assert th["species"]["basil"]["temp_min"] == 20
    th["species"]["basil"]["water_frequent_days"] = 3  # 물주기 확인 간격(3일)과 같으면 안 됨
    assert client.put("/api/settings", json={"thresholds": th}).status_code == 400
    th["species"]["basil"]["water_frequent_days"] = 1.2
    th["general"]["sign_max_age_days"] = 99
    saved = client.put("/api/settings", json={"thresholds": th}).get_json()["thresholds"]
    assert saved["species"]["basil"]["water_frequent_days"] == 1.2
    assert saved["general"]["sign_max_age_days"] == 14


def test_csv_has_soil_state_and_signs(client):
    pid = two_photos(client)
    mid = client.get(f"/api/plants/{pid}").get_json()["measurements"][-1]["id"]
    client.patch(f"/api/measurements/{mid}", json={"observation": {"soil_state": "moist", "signs": ["yellow", "crowded"]}})
    text = client.get("/api/export.csv").data.decode("utf-8-sig")
    header, *rows = text.strip().splitlines()
    assert "흙 상태" in header and "특이사항" in header
    assert "촉촉함" in rows[-1] and "잎이 노래짐, 잎이 빽빽하게 겹침" in rows[-1]


def test_validation_replay_uses_observations_up_to_each_photo():
    start = datetime(2026, 10, 1, 9, 0)
    ms = [{"id": i + 1, "taken_at": (start + timedelta(days=2 * i)).isoformat(), "height_px": 100 + i,
           "width_px": 100, "area_px": a} for i, a in enumerate([1000, 1200, 1440, 1730])]
    leggy_at = (start + timedelta(days=5)).isoformat()
    plant = {"id": 1, "name": "P1", "species": "basil", "unit": "px", "series": with_units(ms),
             "env": [], "care": [], "scans": [],
             "observations": [{"at": leggy_at, "soil_state": None, "signs": ["leggy"], "care_id": None}]}
    events, points = validation.plant_events(plant, default_thresholds())
    leggy = [e for e in events if e["code"] == "light_leggy"]
    assert [e["at"][:10] for e in leggy] == ["2026-10-07"]  # 5일째 기록 → 6일째 사진부터 (미래 기록은 안 씀)
