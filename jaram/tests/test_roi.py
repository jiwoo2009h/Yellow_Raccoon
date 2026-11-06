import io
import sqlite3

import cv2
import numpy as np
import pytest

import db
from seed_demo import draw_plant
from vision import PlantAnalyzer, PlantNotFoundError, roi_to_pixels


def with_neighbor(size=0.35):
    """가운데 식물 + 왼쪽 가장자리에 걸친 큰 초록 덩어리(옆 화분 잎)"""
    img = draw_plant(size, "basil", seed=3)
    cv2.ellipse(img, (40, 420), (150, 230), 0, 0, 360, (40, 150, 50), -1)
    return img


def test_roi_to_pixels():
    assert roi_to_pixels(None, 100, 100) is None
    assert roi_to_pixels([0.1, 0.2, 0.9, 0.8], 1000, 500) == (100, 100, 900, 400)
    assert roi_to_pixels([0.5, 0.5, 0.51, 0.51], 1000, 1000) is None  # 너무 작음


def test_neighbor_leaves_are_picked_without_roi_but_not_with_roi():
    img = with_neighbor()
    plain = PlantAnalyzer().analyze(img)
    assert plain.bbox[0] < 100, "ROI 없이는 더 큰 옆 덩어리가 선택됨"
    res = PlantAnalyzer().analyze(img, roi=[0.3, 0.0, 0.85, 1.0])
    x, y, w, h = res.bbox
    assert x > 0.3 * img.shape[1]
    assert x + w < 0.86 * img.shape[1]


def test_center_preference_picks_middle_plant():
    res = PlantAnalyzer().analyze(with_neighbor(), prefer="center")
    x, _, w, _ = res.bbox
    assert abs((x + w / 2) - 480) < 80


def test_roi_without_plant_raises():
    with pytest.raises(PlantNotFoundError):
        PlantAnalyzer().analyze(draw_plant(0.3), roi=[0.0, 0.0, 0.2, 0.2])


def test_old_database_is_upgraded(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE plants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT,
            species TEXT NOT NULL DEFAULT 'basil', cm_per_px REAL, calibration TEXT, memo TEXT, created_at TEXT NOT NULL);
        INSERT INTO plants(name, species, created_at) VALUES('바질 1', 'basil', '2026-10-01T09:00:00');
    """)
    old.commit()
    old.close()
    db.init(str(path))
    conn = db.connect(str(path))
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(plants)")}
    assert "roi" in cols
    assert conn.execute("SELECT name FROM plants").fetchone()["name"] == "바질 1"
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"scans", "scan_views"} <= tables
    db.init(str(path))  # 두 번 실행해도 안전


def test_roi_api_and_reanalyze(client):
    pid = client.post("/api/plants", json={"name": "바질 1", "code": "B1"}).get_json()["id"]
    ok, buf = cv2.imencode(".jpg", with_neighbor())
    up = client.post(f"/api/plants/{pid}/measurements", data={"photo": (io.BytesIO(buf.tobytes()), "a.jpg")},
                     content_type="multipart/form-data")
    assert up.get_json()["measurement"]["bbox"][0] < 100

    assert client.patch(f"/api/plants/{pid}", json={"roi": [0.1, 0.1, 0.12, 0.12]}).status_code == 400
    res = client.patch(f"/api/plants/{pid}", json={"roi": {"x0": 0.3, "y0": 0, "x1": 0.85, "y1": 1}})
    assert res.get_json()["roi"] == [0.3, 0, 0.85, 1]
    assert client.post(f"/api/plants/{pid}/reanalyze").get_json() == {"ok": 1, "failed": 0}
    latest = client.get(f"/api/plants/{pid}").get_json()["latest"]
    assert latest["bbox"][0] > 0.3 * 960 * (1280 / 1280)

    assert client.patch(f"/api/plants/{pid}", json={"roi": None}).get_json()["roi"] is None
    assert np.isfinite(latest["area_px"])
