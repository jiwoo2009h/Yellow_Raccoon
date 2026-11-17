"""기록 시각의 시간대: 서버 시계가 UTC 여도(PythonAnywhere) 한국 시각으로 저장되는지."""

from datetime import datetime, timedelta, timezone

import app as app_mod
from growth import with_units
from recommend import evaluate
from test_api import make_plant, photo
from thresholds import GENERAL_DEFAULTS, SPECIES_DEFAULTS


def korea_now():
    return (datetime.now(timezone.utc) + timedelta(hours=9)).replace(tzinfo=None)


def test_server_stamps_korean_time_whatever_the_machine_clock(monkeypatch):
    monkeypatch.delenv("JARAM_TZ", raising=False)
    stamp = datetime.fromisoformat(app_mod.now_iso())
    assert abs((stamp - korea_now()).total_seconds()) < 5


def test_parse_dt_keeps_wall_time_and_converts_zoned_values(monkeypatch):
    monkeypatch.delenv("JARAM_TZ", raising=False)
    assert app_mod.parse_dt("2026-11-10T10:30") == "2026-11-10T10:30:00"  # 휴대폰 datetime-local
    assert app_mod.parse_dt("2026-11-10T01:30:00Z") == "2026-11-10T10:30:00"  # 예전에는 Z 를 지워 01:30 이 됐음
    assert app_mod.parse_dt("2026-11-10T01:30:00.250+00:00") == "2026-11-10T10:30:00"


def test_local_option_and_unknown_zone(monkeypatch):
    monkeypatch.setenv("JARAM_TZ", "local")
    assert abs((datetime.fromisoformat(app_mod.now_iso()) - datetime.now()).total_seconds()) < 5
    monkeypatch.setenv("JARAM_TZ", "Mars/Olympus")
    assert app_mod.app_timezone().utcoffset(None) == timedelta(hours=9)


def test_photo_without_time_and_care_sheet_share_one_clock(client, monkeypatch):
    monkeypatch.delenv("JARAM_TZ", raising=False)
    pid = make_plant(client)["id"]
    res = client.post(f"/api/plants/{pid}/measurements", data={"photo": (photo(1.0), "p.jpg")},
                      content_type="multipart/form-data")
    assert res.status_code == 201
    taken = datetime.fromisoformat(res.get_json()["measurement"]["taken_at"])
    assert abs((taken - korea_now()).total_seconds()) < 60


def test_csv_exports_start_with_bom_for_excel(client):
    """BOM 은 소스에 '\\ufeff' 이스케이프로 적어요. 글자 그대로 두면 온라인 편집기가 지워서 엑셀에서 한글이 깨져요."""
    make_plant(client)
    for url in ("/api/export.csv", "/api/validation.csv", "/api/export_scans.csv"):
        res = client.get(url)
        assert res.status_code == 200, url
        assert res.data.startswith("﻿".encode()), url


def test_mixed_clocks_would_change_the_recommendation():
    """사진만 UTC 로 적히면(9시간 이르게) 오전에 준 물이 '토양 수분 기록 뒤'로 보여 물 부족 추천이 사라져요."""
    d0 = datetime(2026, 11, 1)

    def run(photo_shift_h):
        shift = timedelta(hours=photo_shift_h)
        ms = [{"id": i + 1, "taken_at": (d0 + timedelta(days=2 * i, hours=15) + shift).isoformat(),
               "height_px": 100 + 5 * i, "width_px": 100, "area_px": a, "hue": 60}
              for i, a in enumerate([1000, 1200, 1440, 1730, 1760, 1780])]
        series = with_units(ms)
        env = [{"at": series[-1]["taken_at"], "temp": None, "humidity": None, "soil": 18, "lux": None}]
        care = [{"at": (d0 + timedelta(days=10, hours=10)).isoformat(), "kind": "water"}]
        r = evaluate(series, env, care, SPECIES_DEFAULTS["basil"], GENERAL_DEFAULTS,
                     d0 + timedelta(days=10, hours=16) + shift)
        return [x["code"] for x in r["recs"]]

    assert "water_needed" in run(0)  # 한 시계(한국 시각)로 통일 = 이번 수정 후
    assert "water_needed" not in run(-9)  # 사진만 UTC = 수정 전 PythonAnywhere
