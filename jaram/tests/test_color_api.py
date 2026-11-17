"""잎 색 지표가 측정 기록에 저장되고, 예전 기록은 '다시 분석'으로 채워지는지."""

import io
import sqlite3

import cv2

from seed_demo import draw_plant


def photo(size=0.4, seed=1):
    ok, buf = cv2.imencode(".jpg", draw_plant(size, "basil", seed=seed))
    return io.BytesIO(buf.tobytes())


def test_upload_saves_leaf_color_and_reanalyze_fills_old_records(client):
    app = client.application
    pid = client.post("/api/plants", json={"name": "바질 1", "code": "B1"}).get_json()["id"]
    m = client.post(f"/api/plants/{pid}/measurements", data={"photo": (photo(), "a.jpg")},
                    content_type="multipart/form-data").get_json()["measurement"]
    col = m["color"]
    assert 110 < col["hue"] < 160 and col["yellow"] < 5 and col["rgb"].startswith("#") and col["wb"] is True

    # 잎 색 지표가 생기기 전의 기록처럼 비워 두면 → 다시 분석하면 채워져요
    db = sqlite3.connect(app.config["DB_PATH"])
    db.execute("UPDATE measurements SET color = NULL")
    db.commit()
    db.close()
    assert client.get(f"/api/plants/{pid}").get_json()["measurements"][0]["color"] is None
    assert client.post(f"/api/plants/{pid}/reanalyze").get_json()["ok"] == 1
    again = client.get(f"/api/plants/{pid}").get_json()["measurements"][0]["color"]
    assert again["hue"] == col["hue"]

    csv = client.get("/api/export.csv").data.decode("utf-8-sig")
    header = csv.splitlines()[0]
    assert "잎 색상각(°)" in header and "노란 쪽 잎(%)" in header
    assert col["rgb"] in csv
