"""자람 — 식물 생장 기록 & 관리 추천 웹앱 (Flask 서버).

실행:  python app.py            → 같은 와이파이의 휴대폰에서 http://<컴퓨터IP>:5000 접속
       python app.py --https    → 휴대폰에서 실시간 카메라(이전 사진 겹쳐 보기)까지 사용

환경 변수
  JARAM_DATA           데이터(DB·사진) 폴더. 기본값: 이 폴더의 data/
  JARAM_PASSWORD       설정하면 팀 비밀번호로 로그인해야 쓸 수 있어요. 인터넷에 배포할 때는 꼭 설정하세요.
  JARAM_SECRET_KEY     로그인 쿠키 서명 키. 없으면 데이터 폴더에 자동으로 만들어 저장해요.
  JARAM_SECURE_COOKIE  1 이면 HTTPS 에서만 로그인 쿠키를 보내요. HTTPS 로 배포할 때 설정하세요.
"""

import argparse
import csv
import hmac
import io
import json
import math
import os
import re
import secrets
import socket
import sqlite3
import tempfile
import time
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from types import SimpleNamespace

from flask import Flask, Response, g, jsonify, request, send_file, send_from_directory, session

import db
import scans_api
from growth import parse_time, scan_series, with_units
from recommend import evaluate
from thresholds import SPECIES_KEYS, default_thresholds, merge_thresholds
from vision import PlantAnalyzer, PlantNotFoundError, encode_jpeg, encode_png, load_image

BASE_DIR = Path(__file__).resolve().parent
CARE_KINDS = {
    "water": "물주기",
    "move": "위치 변경",
    "light": "조명 조정",
    "fertilize": "비료",
    "prune": "가지치기",
    "other": "기타",
}
ENV_FIELDS = {
    "temp": (-20, 60),
    "humidity": (0, 100),
    "soil": (0, 100),
    "lux": (0, 200000),
}


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# ----------------------------------------------------------------------
# 작은 도우미 함수들
# ----------------------------------------------------------------------

def now_iso():
    return datetime.now().replace(microsecond=0).isoformat()


def parse_dt(value):
    """'2026-11-04T09:30' 같은 값을 받아 표준 ISO 문자열로 바꿉니다."""
    if value in (None, ""):
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", ""))
    except ValueError as exc:
        raise ApiError("날짜 형식이 올바르지 않아요.") from exc
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt.replace(microsecond=0).isoformat()


def num(value, lo=None, hi=None, label="값"):
    if value in (None, ""):
        return None
    try:
        x = float(value)
    except (TypeError, ValueError) as exc:
        raise ApiError(f"{label}은(는) 숫자로 입력해 주세요.") from exc
    if math.isnan(x) or math.isinf(x):
        raise ApiError(f"{label}이(가) 올바르지 않아요.")
    if (lo is not None and x < lo) or (hi is not None and x > hi):
        raise ApiError(f"{label}은(는) {lo}~{hi} 사이로 입력해 주세요.")
    return x


def text(value, max_len, label="값", required=False):
    s = (value or "").strip() if isinstance(value, str) else ("" if value is None else str(value).strip())
    if required and not s:
        raise ApiError(f"{label}을(를) 입력해 주세요.")
    if len(s) > max_len:
        raise ApiError(f"{label}은(는) {max_len}자 이하로 입력해 주세요.")
    return s or None


def clean(obj, digits=4):
    """JSON 으로 보내기 전에 실수를 반올림하고 NaN 을 없앱니다."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return round(obj, digits)
    if isinstance(obj, dict):
        return {k: clean(v, digits) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v, digits) for v in obj]
    return obj


def safe_code(value):
    return re.sub(r"[^A-Za-z0-9_-]", "", value or "")[:12]


def load_secret_key(data_dir):
    """로그인 쿠키 서명 키. 서버를 다시 켜도 로그인이 유지되도록 파일에 저장합니다."""
    path = Path(data_dir) / "secret_key"
    if path.exists():
        return path.read_text().strip()
    key = secrets.token_hex(32)
    path.write_text(key)
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return key


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


# ----------------------------------------------------------------------
# 앱
# ----------------------------------------------------------------------

def create_app(data_dir=None, password=None):
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    data_dir = Path(data_dir or os.environ.get("JARAM_DATA") or BASE_DIR / "data")
    upload_dir = data_dir / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    app.config.update(
        DATA_DIR=data_dir,
        DB_PATH=str(data_dir / "jaram.db"),
        UPLOAD_DIR=upload_dir,
        MAX_CONTENT_LENGTH=20 * 1024 * 1024,
        JSON_AS_ASCII=False,
        PASSWORD=password if password is not None else (os.environ.get("JARAM_PASSWORD") or None),
        SECRET_KEY=os.environ.get("JARAM_SECRET_KEY") or load_secret_key(data_dir),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("JARAM_SECURE_COOKIE") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(days=180),
    )
    app.json.ensure_ascii = False
    db.init(app.config["DB_PATH"])

    # ---------------- 팀 비밀번호 로그인 ----------------
    # JARAM_PASSWORD 가 있을 때만 동작합니다. (같은 와이파이에서만 쓸 때는 로그인 없이 사용)
    login_failures = {}

    def auth_required():
        return bool(app.config["PASSWORD"])

    @app.before_request
    def require_login():
        if not auth_required():
            return None
        path = request.path
        if not (path.startswith("/api/") or path.startswith("/media/")):
            return None  # 화면 파일(HTML·CSS·JS)에는 기록이 없으니 공개
        if path in ("/api/auth", "/api/login"):
            return None
        if not session.get("auth"):
            return jsonify(error="로그인이 필요해요.", auth_required=True), 401
        # 다른 사이트에서 몰래 요청을 보내는 것(CSRF)을 막기 위해 앱이 붙이는 헤더를 확인
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("X-Requested-With") != "jaram":
            return jsonify(error="잘못된 요청이에요."), 403
        return None

    @app.get("/api/auth")
    def auth_status():
        return jsonify(required=auth_required(), authenticated=not auth_required() or bool(session.get("auth")))

    @app.post("/api/login")
    def login():
        if not auth_required():
            return jsonify(ok=True)
        if request.headers.get("X-Requested-With") != "jaram":
            return jsonify(error="잘못된 요청이에요."), 403
        ip = request.headers.get("X-Real-IP") or request.remote_addr or "?"
        now = time.time()
        fails, since = login_failures.get(ip, (0, now))
        if now - since > 600:
            fails, since = 0, now
        if fails >= 10:
            return jsonify(error="비밀번호를 너무 많이 틀렸어요. 10분 뒤에 다시 시도해 주세요."), 429
        given = str((request.get_json(silent=True) or {}).get("password") or "")
        if hmac.compare_digest(given.encode("utf-8"), app.config["PASSWORD"].encode("utf-8")):
            login_failures.pop(ip, None)
            session.clear()
            session.permanent = True
            session["auth"] = True
            return jsonify(ok=True)
        login_failures[ip] = (fails + 1, since)
        time.sleep(0.4)
        return jsonify(error="비밀번호가 맞지 않아요."), 401

    @app.post("/api/logout")
    def logout():
        session.clear()
        return jsonify(ok=True)

    # ---------------- DB 연결 ----------------
    def conn():
        if "db" not in g:
            g.db = db.connect(app.config["DB_PATH"])
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        c = g.pop("db", None)
        if c is not None:
            c.close()

    @app.errorhandler(ApiError)
    def on_api_error(err):
        return jsonify(error=err.message), err.status

    @app.errorhandler(413)
    def too_large(_err):
        return jsonify(error="사진 용량이 너무 커요 (최대 20MB)."), 413

    @app.errorhandler(404)
    def not_found(err):
        if request.path.startswith("/api/"):
            return jsonify(error="찾을 수 없어요."), 404
        return err

    # ---------------- 공통 로직 ----------------
    def thresholds():
        return merge_thresholds(db.get_setting(conn(), "thresholds"))

    def species_cfg(th, species):
        return th["species"].get(species) or th["species"]["other"]

    def media_url(name):
        return f"/media/{name}" if name else None

    def get_plant(pid):
        p = db.row(conn().execute("SELECT * FROM plants WHERE id = ?", (pid,)).fetchone())
        if p is None:
            raise ApiError("식물을 찾을 수 없어요.", 404)
        return p

    def plant_roi(plant):
        """식물별 분석 영역 [x0, y0, x1, y1] (0~1 비율) 또는 None"""
        try:
            return json.loads(plant["roi"]) if plant.get("roi") else None
        except ValueError:
            return None

    def load_measurements(pid):
        ms = db.rows(conn().execute(
            "SELECT * FROM measurements WHERE plant_id = ? ORDER BY taken_at, id", (pid,)))
        for m in ms:
            m["bbox"] = json.loads(m["bbox"]) if m["bbox"] else None
            m["warnings"] = json.loads(m["warnings"]) if m["warnings"] else []
        return ms

    def bundle(plant, th=None):
        """식물 하나의 기록 + 생장 계산 + 추천 결과를 한 번에 만듭니다."""
        th = th or thresholds()
        ms = load_measurements(plant["id"])
        series = with_units(ms, plant["cm_per_px"])
        env = db.rows(conn().execute(
            "SELECT * FROM env_logs WHERE plant_id = ? ORDER BY at, id", (plant["id"],)))
        care = db.rows(conn().execute(
            "SELECT * FROM care_logs WHERE plant_id = ? ORDER BY at, id", (plant["id"],)))
        unit = "cm" if plant["cm_per_px"] else "px"
        result = evaluate(series, env, care, species_cfg(th, plant["species"]), th["general"],
                          datetime.now(), unit)
        return series, env, care, result

    def m_json(e, env_by_m):
        env = env_by_m.get(e["id"])
        return {
            "id": e["id"],
            "plant_id": e["plant_id"],
            "taken_at": e["taken_at"],
            "photo_url": media_url(e["photo"]),
            "overlay_url": media_url(e["overlay"]),
            "mask_url": media_url(e["mask"]),
            "img_w": e["img_w"],
            "img_h": e["img_h"],
            "bbox": e["bbox"],
            "height_px": e["height_px"],
            "width_px": e["width_px"],
            "area_px": e["area_px"],
            "height": e["height"],
            "width": e["width"],
            "area": e["area"],
            "hue": e["hue"],
            "delta": e["delta"],
            "warnings": e["warnings"],
            "manual_height_cm": e["manual_height_cm"],
            "manual_width_cm": e["manual_width_cm"],
            "leaf_count": e["leaf_count"],
            "note": e["note"],
            "env": {k: env[k] for k in ENV_FIELDS} if env else None,
        }

    def plant_json(plant, series, env, care, result, detail=False):
        th_label = species_cfg(thresholds(), plant["species"])["label"]
        env_by_m = {e["measurement_id"]: e for e in env if e["measurement_id"]}
        latest = series[-1] if series else None
        data = {
            "id": plant["id"],
            "name": plant["name"],
            "code": plant["code"],
            "species": plant["species"],
            "species_label": th_label,
            "memo": plant["memo"],
            "created_at": plant["created_at"],
            "cm_per_px": plant["cm_per_px"],
            "calibration": json.loads(plant["calibration"]) if plant["calibration"] else None,
            "roi": plant_roi(plant),
            "unit": "cm" if plant["cm_per_px"] else "px",
            "count": len(series),
            "first_taken_at": series[0]["taken_at"] if series else None,
            "latest": m_json(latest, env_by_m) if latest else None,
            "status": result["status"],
            "status_label": result["status_label"],
            "headline": result["headline"],
            "recs": result["recs"],
            "summary": result["summary"],
            "facts": result["facts"],
            "last_care": care[-1] if care else None,
        }
        if detail:
            data["scans"] = [scans_api.scan_summary(sc, media_url) for sc in load_scans(plant)]
            data["measurements"] = [m_json(e, env_by_m) for e in series]
            data["env_logs"] = env
            data["care_logs"] = [{**c, "kind_label": CARE_KINDS.get(c["kind"], c["kind"])} for c in care]
        return clean(data)

    def save_files(plant, res, taken_at):
        folder = app.config["UPLOAD_DIR"] / str(plant["id"])
        folder.mkdir(parents=True, exist_ok=True)
        code = safe_code(plant["code"]) or f"P{plant['id']}"
        stem = f"{code}_{parse_time(taken_at):%Y%m%d-%H%M%S}_{uuid.uuid4().hex[:6]}"
        names = {
            "photo": f"{plant['id']}/{stem}.jpg",
            "mask": f"{plant['id']}/{stem}_mask.png",
            "overlay": f"{plant['id']}/{stem}_overlay.jpg",
        }
        (app.config["UPLOAD_DIR"] / names["photo"]).write_bytes(encode_jpeg(res.image, 90))
        (app.config["UPLOAD_DIR"] / names["mask"]).write_bytes(encode_png(res.mask))
        (app.config["UPLOAD_DIR"] / names["overlay"]).write_bytes(encode_jpeg(res.overlay, 85))
        return names

    def remove_files(*names):
        for name in names:
            if not name:
                continue
            path = (app.config["UPLOAD_DIR"] / name).resolve()
            if app.config["UPLOAD_DIR"].resolve() in path.parents and path.exists():
                path.unlink()

    def insert_measurement(plant_id, names, m, taken_at):
        """분석 결과(metrics)와 저장한 파일 이름으로 측정 기록 한 줄을 만듭니다."""
        cur = conn().execute(
            """INSERT INTO measurements(plant_id, taken_at, photo, mask, overlay, img_w, img_h,
                   height_px, width_px, area_px, bbox, hue, sat, val, warnings, created_at)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (plant_id, taken_at, names["photo"], names["mask"], names["overlay"], m["img_w"], m["img_h"],
             m["height_px"], m["width_px"], m["area_px"], json.dumps(m["bbox"]), m["hue"], m["sat"],
             m["val"], json.dumps(m["warnings"], ensure_ascii=False), now_iso()))
        return cur.lastrowid

    def load_scans(plant):
        """완료된 3D 측정 목록 (cm 단위·직전 대비 변화 포함)"""
        rows_ = db.rows(conn().execute(
            "SELECT s.*, (SELECT v.photo FROM scan_views v WHERE v.scan_id = s.id AND v.kind = 'side' "
            "AND v.angle = 0 LIMIT 1) AS thumb FROM scans s "
            "WHERE s.plant_id = ? AND s.status = 'done' ORDER BY s.taken_at, s.id", (plant["id"],)))
        return scan_series(rows_, plant["cm_per_px"])

    def measurement_context(mid):
        m = db.row(conn().execute("SELECT * FROM measurements WHERE id = ?", (mid,)).fetchone())
        if m is None:
            raise ApiError("기록을 찾을 수 없어요.", 404)
        plant = get_plant(m["plant_id"])
        series, env, care, result = bundle(plant)
        env_by_m = {e["measurement_id"]: e for e in env if e["measurement_id"]}
        idx = next(i for i, e in enumerate(series) if e["id"] == mid)
        current = m_json(series[idx], env_by_m)
        previous = m_json(series[idx - 1], env_by_m) if idx > 0 else None
        first = m_json(series[0], env_by_m) if idx > 0 else None
        # 같은 챔버에서 최근 12시간 안에 기록한 온도·습도·조도를 미리 채워 주기 위한 값
        since = (parse_time(m["taken_at"]) - timedelta(hours=12)).isoformat()
        shared = db.row(conn().execute(
            "SELECT at, temp, humidity, lux FROM env_logs WHERE at >= ? AND at <= ? "
            "AND (temp IS NOT NULL OR humidity IS NOT NULL OR lux IS NOT NULL) "
            "AND (measurement_id IS NULL OR measurement_id != ?) ORDER BY at DESC LIMIT 1",
            (since, (parse_time(m["taken_at"]) + timedelta(hours=1)).isoformat(), mid)).fetchone())
        return clean({
            "measurement": current,
            "previous": previous,
            "first": first,
            "index": idx,
            "plant": plant_json(plant, series, env, care, result),
            "suggest_env": shared,
        })

    def read_env(body):
        return {k: num(body.get(k), lo, hi, {"temp": "온도", "humidity": "습도", "soil": "토양 수분",
                                              "lux": "조도"}[k]) for k, (lo, hi) in ENV_FIELDS.items()}

    # ---------------- 화면 ----------------
    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/manifest.webmanifest")
    def manifest():
        return send_from_directory(app.static_folder, "manifest.webmanifest",
                                   mimetype="application/manifest+json")

    @app.get("/media/<path:name>")
    def media(name):
        return send_from_directory(app.config["UPLOAD_DIR"], name, max_age=60 * 60 * 24 * 30)

    # ---------------- 식물 ----------------
    @app.get("/api/plants")
    def list_plants():
        th = thresholds()
        plants = db.rows(conn().execute("SELECT * FROM plants ORDER BY id"))
        out = []
        for p in plants:
            series, env, care, result = bundle(p, th)
            out.append(plant_json(p, series, env, care, result))
        return jsonify(plants=out, server_time=now_iso())

    @app.post("/api/plants")
    def create_plant():
        body = request.get_json(silent=True) or {}
        species = body.get("species") or "basil"
        if species not in SPECIES_KEYS:
            raise ApiError("식물 종류가 올바르지 않아요.")
        cur = conn().execute(
            "INSERT INTO plants(name, code, species, memo, created_at) VALUES(?, ?, ?, ?, ?)",
            (text(body.get("name"), 30, "이름", required=True), text(body.get("code"), 12, "식물 ID"),
             species, text(body.get("memo"), 300, "메모"), now_iso()))
        conn().commit()
        return plant_detail(cur.lastrowid), 201

    @app.get("/api/plants/<int:pid>")
    def plant_detail(pid):
        plant = get_plant(pid)
        series, env, care, result = bundle(plant)
        return jsonify(plant_json(plant, series, env, care, result, detail=True))

    @app.patch("/api/plants/<int:pid>")
    def update_plant(pid):
        plant = get_plant(pid)
        body = request.get_json(silent=True) or {}
        fields = {}
        if "name" in body:
            fields["name"] = text(body["name"], 30, "이름", required=True)
        if "code" in body:
            fields["code"] = text(body["code"], 12, "식물 ID")
        if "memo" in body:
            fields["memo"] = text(body["memo"], 300, "메모")
        if "species" in body:
            if body["species"] not in SPECIES_KEYS:
                raise ApiError("식물 종류가 올바르지 않아요.")
            fields["species"] = body["species"]
        if "calibration" in body:
            cal = body["calibration"]
            if cal is None:
                fields["calibration"] = None
                fields["cm_per_px"] = None
            else:
                pts = [num(cal.get(k), 0, 10000, "좌표") for k in ("x1", "y1", "x2", "y2")]
                if any(v is None for v in pts):
                    raise ApiError("자의 두 점을 모두 찍어 주세요.")
                length = num(cal.get("length_cm"), 0.1, 200, "실제 길이")
                if length is None:
                    raise ApiError("실제 길이를 입력해 주세요.")
                dist = math.dist(pts[:2], pts[2:])
                if dist < 10:
                    raise ApiError("두 점이 너무 가까워요. 자의 눈금을 더 길게 잡아 주세요.")
                fields["cm_per_px"] = length / dist
                fields["calibration"] = json.dumps({
                    "x1": pts[0], "y1": pts[1], "x2": pts[2], "y2": pts[3],
                    "length_cm": length, "pixels": round(dist, 2),
                    "measurement_id": cal.get("measurement_id"),
                })
        if "roi" in body:
            roi = body["roi"]
            if roi is None:
                fields["roi"] = None
            else:
                if isinstance(roi, dict):
                    roi = [roi.get(k) for k in ("x0", "y0", "x1", "y1")]
                if not isinstance(roi, (list, tuple)) or len(roi) != 4:
                    raise ApiError("분석 영역 형식이 올바르지 않아요.")
                x0, y0, x1, y1 = [num(v, 0, 1, "분석 영역 좌표") for v in roi]
                if None in (x0, y0, x1, y1) or x1 - x0 < 0.05 or y1 - y0 < 0.05:
                    raise ApiError("분석 영역이 너무 작아요. 식물이 다 들어가게 넓혀 주세요.")
                fields["roi"] = json.dumps([round(v, 4) for v in (x0, y0, x1, y1)])
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn().execute(f"UPDATE plants SET {sets} WHERE id = ?", (*fields.values(), plant["id"]))
            conn().commit()
        return plant_detail(pid)

    @app.delete("/api/plants/<int:pid>")
    def delete_plant(pid):
        plant = get_plant(pid)
        files = [tuple(f) for f in conn().execute(
            "SELECT photo, mask, overlay FROM measurements WHERE plant_id = ?", (pid,)).fetchall()]
        files += [tuple(f) for f in conn().execute(
            "SELECT v.photo, v.mask, v.overlay FROM scan_views v JOIN scans s ON s.id = v.scan_id "
            "WHERE s.plant_id = ?", (pid,)).fetchall()]
        files += [(f["points"],) for f in conn().execute("SELECT points FROM scans WHERE plant_id = ?", (pid,)).fetchall()]
        conn().execute("DELETE FROM plants WHERE id = ?", (plant["id"],))
        conn().commit()
        for f in files:
            remove_files(*f)
        return jsonify(ok=True)

    # ---------------- 촬영 / 분석 ----------------
    @app.post("/api/plants/<int:pid>/measurements")
    def upload_measurement(pid):
        plant = get_plant(pid)
        f = request.files.get("photo")
        if f is None:
            raise ApiError("사진을 선택해 주세요.")
        try:
            image = load_image(f.read())
        except ValueError as exc:
            raise ApiError(str(exc)) from exc
        cfg = species_cfg(thresholds(), plant["species"])
        try:
            res = PlantAnalyzer(cfg["hsv_lower"], cfg["hsv_upper"]).analyze(image, roi=plant_roi(plant))
        except PlantNotFoundError as exc:
            raise ApiError(str(exc), 422) from exc
        taken_at = parse_dt(request.form.get("taken_at")) or now_iso()
        names = save_files(plant, res, taken_at)
        mid = insert_measurement(pid, names, res.metrics(), taken_at)
        conn().commit()
        return jsonify(measurement_context(mid)), 201

    @app.get("/api/measurements/<int:mid>")
    def get_measurement(mid):
        return jsonify(measurement_context(mid))

    @app.patch("/api/measurements/<int:mid>")
    def update_measurement(mid):
        m = db.row(conn().execute("SELECT * FROM measurements WHERE id = ?", (mid,)).fetchone())
        if m is None:
            raise ApiError("기록을 찾을 수 없어요.", 404)
        body = request.get_json(silent=True) or {}
        fields = {}
        if "taken_at" in body:
            fields["taken_at"] = parse_dt(body["taken_at"]) or m["taken_at"]
        if "manual_height_cm" in body:
            fields["manual_height_cm"] = num(body["manual_height_cm"], 0, 300, "직접 측정한 높이")
        if "manual_width_cm" in body:
            fields["manual_width_cm"] = num(body["manual_width_cm"], 0, 300, "직접 측정한 폭")
        if "leaf_count" in body:
            v = num(body["leaf_count"], 0, 999, "잎 수")
            fields["leaf_count"] = int(v) if v is not None else None
        if "note" in body:
            fields["note"] = text(body["note"], 300, "메모")
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn().execute(f"UPDATE measurements SET {sets} WHERE id = ?", (*fields.values(), mid))
        taken_at = fields.get("taken_at", m["taken_at"])
        if "env" in body:
            env = read_env(body["env"] or {})
            conn().execute("DELETE FROM env_logs WHERE measurement_id = ?", (mid,))
            if any(v is not None for v in env.values()):
                conn().execute(
                    "INSERT INTO env_logs(plant_id, measurement_id, at, temp, humidity, soil, lux) "
                    "VALUES(?, ?, ?, ?, ?, ?, ?)",
                    (m["plant_id"], mid, taken_at, env["temp"], env["humidity"], env["soil"], env["lux"]))
        elif "taken_at" in fields:
            conn().execute("UPDATE env_logs SET at = ? WHERE measurement_id = ?", (taken_at, mid))
        conn().commit()
        return jsonify(measurement_context(mid))

    @app.delete("/api/measurements/<int:mid>")
    def delete_measurement(mid):
        m = db.row(conn().execute("SELECT * FROM measurements WHERE id = ?", (mid,)).fetchone())
        if m is None:
            raise ApiError("기록을 찾을 수 없어요.", 404)
        conn().execute("DELETE FROM measurements WHERE id = ?", (mid,))
        conn().commit()
        remove_files(m["photo"], m["mask"], m["overlay"])
        return jsonify(ok=True)

    def reanalyze_plant(plant, th):
        cfg = species_cfg(th, plant["species"])
        analyzer = PlantAnalyzer(cfg["hsv_lower"], cfg["hsv_upper"])
        ok = failed = 0
        for m in conn().execute("SELECT * FROM measurements WHERE plant_id = ?", (plant["id"],)).fetchall():
            path = app.config["UPLOAD_DIR"] / m["photo"]
            if not path.exists():
                failed += 1
                continue
            try:
                res = analyzer.analyze(load_image(path.read_bytes()), roi=plant_roi(plant))
            except (PlantNotFoundError, ValueError):
                failed += 1
                continue
            # 새 파일 이름으로 저장해야 휴대폰 브라우저 캐시에 옛 분석 이미지가 남지 않아요.
            stem = Path(m["photo"]).stem
            mask_name = f"{plant['id']}/{stem}_mask_{uuid.uuid4().hex[:4]}.png"
            overlay_name = f"{plant['id']}/{stem}_overlay_{uuid.uuid4().hex[:4]}.jpg"
            (app.config["UPLOAD_DIR"] / mask_name).write_bytes(encode_png(res.mask))
            (app.config["UPLOAD_DIR"] / overlay_name).write_bytes(encode_jpeg(res.overlay, 85))
            remove_files(m["mask"], m["overlay"])
            mt = res.metrics()
            conn().execute(
                """UPDATE measurements SET mask = ?, overlay = ?, height_px = ?, width_px = ?,
                       area_px = ?, bbox = ?, hue = ?, sat = ?, val = ?, warnings = ? WHERE id = ?""",
                (mask_name, overlay_name, mt["height_px"], mt["width_px"], mt["area_px"],
                 json.dumps(mt["bbox"]), mt["hue"], mt["sat"], mt["val"],
                 json.dumps(mt["warnings"], ensure_ascii=False), m["id"]))
            ok += 1
        conn().commit()
        return ok, failed

    @app.post("/api/plants/<int:pid>/reanalyze")
    def reanalyze(pid):
        ok, failed = reanalyze_plant(get_plant(pid), thresholds())
        return jsonify(ok=ok, failed=failed)

    @app.post("/api/reanalyze")
    def reanalyze_all():
        th = thresholds()
        total_ok = total_failed = 0
        for p in db.rows(conn().execute("SELECT * FROM plants")):
            ok, failed = reanalyze_plant(p, th)
            total_ok += ok
            total_failed += failed
        return jsonify(ok=total_ok, failed=total_failed)

    # ---------------- 관리 기록 / 환경 기록 ----------------
    @app.post("/api/plants/<int:pid>/care")
    def add_care(pid):
        plant = get_plant(pid)
        body = request.get_json(silent=True) or {}
        kind = body.get("kind")
        if kind not in CARE_KINDS:
            raise ApiError("관리 종류를 선택해 주세요.")
        at = parse_dt(body.get("at")) or now_iso()
        conn().execute(
            "INSERT INTO care_logs(plant_id, at, kind, amount, note, rec_code) VALUES(?, ?, ?, ?, ?, ?)",
            (plant["id"], at, kind, num(body.get("amount"), 0, 100000, "양"),
             text(body.get("note"), 300, "메모"), text(body.get("rec_code"), 40, "추천 코드")))
        env = read_env(body.get("env") or {})
        if any(v is not None for v in env.values()):
            conn().execute(
                "INSERT INTO env_logs(plant_id, at, temp, humidity, soil, lux) VALUES(?, ?, ?, ?, ?, ?)",
                (plant["id"], at, env["temp"], env["humidity"], env["soil"], env["lux"]))
        conn().commit()
        return plant_detail(pid), 201

    @app.delete("/api/care/<int:cid>")
    def delete_care(cid):
        conn().execute("DELETE FROM care_logs WHERE id = ?", (cid,))
        conn().commit()
        return jsonify(ok=True)

    @app.post("/api/plants/<int:pid>/env")
    def add_env(pid):
        plant = get_plant(pid)
        body = request.get_json(silent=True) or {}
        env = read_env(body)
        if all(v is None for v in env.values()):
            raise ApiError("환경 값을 하나 이상 입력해 주세요.")
        at = parse_dt(body.get("at")) or now_iso()
        conn().execute(
            "INSERT INTO env_logs(plant_id, at, temp, humidity, soil, lux) VALUES(?, ?, ?, ?, ?, ?)",
            (plant["id"], at, env["temp"], env["humidity"], env["soil"], env["lux"]))
        if body.get("apply_all") and any(env[k] is not None for k in ("temp", "humidity", "lux")):
            # 같은 챔버의 다른 식물에도 온도·습도·조도를 함께 기록 (토양 수분은 화분마다 달라서 제외)
            for other in conn().execute("SELECT id FROM plants WHERE id != ?", (plant["id"],)).fetchall():
                conn().execute(
                    "INSERT INTO env_logs(plant_id, at, temp, humidity, lux) VALUES(?, ?, ?, ?, ?)",
                    (other["id"], at, env["temp"], env["humidity"], env["lux"]))
        conn().commit()
        return plant_detail(pid), 201

    @app.delete("/api/env/<int:eid>")
    def delete_env(eid):
        conn().execute("DELETE FROM env_logs WHERE id = ?", (eid,))
        conn().commit()
        return jsonify(ok=True)

    # ---------------- 설정(추천 기준) ----------------
    @app.get("/api/settings")
    def get_settings():
        return jsonify(thresholds=thresholds(), defaults=default_thresholds())

    @app.put("/api/settings")
    def put_settings():
        body = request.get_json(silent=True) or {}
        merged = merge_thresholds(body.get("thresholds"))
        for key, cfg in merged["species"].items():
            lo, hi = cfg["hsv_lower"], cfg["hsv_upper"]
            limits = (179, 255, 255)
            cfg["hsv_lower"] = [max(0, min(limits[i], lo[i])) for i in range(3)]
            cfg["hsv_upper"] = [max(0, min(limits[i], hi[i])) for i in range(3)]
            if any(cfg["hsv_lower"][i] >= cfg["hsv_upper"][i] for i in range(3)):
                raise ApiError(f"{cfg['label']}: HSV 최솟값은 최댓값보다 작아야 해요.")
            for a, b, label in (("temp_min", "temp_max", "온도"), ("humidity_min", "humidity_max", "습도"),
                                ("soil_min", "soil_max", "토양 수분")):
                if cfg[a] >= cfg[b]:
                    raise ApiError(f"{cfg['label']}: {label} 최솟값은 최댓값보다 작아야 해요.")
        gen = merged["general"]
        gen["rate_window"] = max(1, min(10, gen["rate_window"]))
        gen["env_lookback"] = max(1, min(10, gen["env_lookback"]))
        gen["persist_count"] = max(1, min(gen["env_lookback"], gen["persist_count"]))
        db.set_setting(conn(), "thresholds", merged)
        conn().commit()
        return get_settings()

    @app.post("/api/settings/reset")
    def reset_settings():
        conn().execute("DELETE FROM settings WHERE key = 'thresholds'")
        conn().commit()
        return get_settings()

    # ---------------- 리포트 / 내보내기 ----------------
    @app.get("/api/report")
    def report():
        th = thresholds()
        out, accuracy = [], []
        for p in db.rows(conn().execute("SELECT * FROM plants ORDER BY id")):
            series, env, care, result = bundle(p, th)
            first = series[0] if series else None
            points = []
            for e in series:
                points.append({
                    "id": e["id"],
                    "taken_at": e["taken_at"],
                    "day": (parse_time(e["taken_at"]) - parse_time(first["taken_at"])).total_seconds() / 86400,
                    "area_pct": (e["area"] / first["area"] - 1) * 100 if first["area"] else None,
                    "height_pct": (e["height"] / first["height"] - 1) * 100 if first["height"] else None,
                    "height": e["height"],
                    "width": e["width"],
                    "area": e["area"],
                })
                if p["cm_per_px"] and (e["manual_height_cm"] or e["manual_width_cm"]):
                    accuracy.append({
                        "plant": p["name"],
                        "taken_at": e["taken_at"],
                        "height_image": e["height"], "height_manual": e["manual_height_cm"],
                        "width_image": e["width"], "width_manual": e["manual_width_cm"],
                    })
            scans = load_scans(p)
            out.append({
                "scans": [{
                    "id": sc["id"], "taken_at": sc["taken_at"], "volume": sc["volume"],
                    "day": (parse_time(sc["taken_at"]) - parse_time(scans[0]["taken_at"])).total_seconds() / 86400,
                    "volume_pct": (sc["volume"] / scans[0]["volume"] - 1) * 100 if scans[0]["volume"] else None,
                } for sc in scans],
                "id": p["id"], "name": p["name"], "code": p["code"], "species": p["species"],
                "species_label": species_cfg(th, p["species"])["label"],
                "unit": "cm" if p["cm_per_px"] else "px",
                "points": points,
                "status": result["status"], "status_label": result["status_label"],
                "summary": result["summary"],
                "care_count": len(care),
            })

        def mae(pairs):
            pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
            if not pairs:
                return None
            return {
                "n": len(pairs),
                "mae": sum(abs(a - b) for a, b in pairs) / len(pairs),
                "mape": sum(abs(a - b) / b * 100 for a, b in pairs if b) / len(pairs),
            }

        acc = {
            "height": mae([(a["height_image"], a["height_manual"]) for a in accuracy]),
            "width": mae([(a["width_image"], a["width_manual"]) for a in accuracy]),
            "items": accuracy[-20:],
        }
        return jsonify(clean({"plants": out, "accuracy": acc}))

    @app.get("/api/export.csv")
    def export_csv():
        th = thresholds()
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["날짜", "식물ID", "식물 이름", "종류", "높이", "폭", "투영면적", "단위",
                    "면적 변화(%)", "면적 생장률(%/일)", "높이 생장률(/일)", "잎 평균 Hue",
                    "온도(℃)", "습도(%)", "토양 수분(%)", "조도(lux)",
                    "직접 측정 높이(cm)", "직접 측정 폭(cm)", "잎 수", "같은 날 관리 행동", "메모", "사진 파일"])
        for p in db.rows(conn().execute("SELECT * FROM plants ORDER BY id")):
            series, env, care, _ = bundle(p, th)
            env_by_m = {e["measurement_id"]: e for e in env if e["measurement_id"]}
            unit = "cm" if p["cm_per_px"] else "px"
            for e in series:
                d = e["delta"] or {}
                ev = env_by_m.get(e["id"]) or {}
                day = e["taken_at"][:10]
                acts = ", ".join(
                    CARE_KINDS.get(c["kind"], c["kind"]) + (f" {c['amount']:g}" if c["amount"] else "")
                    for c in care if c["at"][:10] == day)

                def f(v, digits=3):
                    return "" if v is None else round(v, digits)

                w.writerow([e["taken_at"].replace("T", " "), p["code"] or p["id"], p["name"],
                            species_cfg(th, p["species"])["label"],
                            f(e["height"]), f(e["width"]), f(e["area"]), unit,
                            f(d.get("area_pct")), f(d.get("area_pct_per_day")), f(d.get("height_per_day")),
                            f(e["hue"], 2), f(ev.get("temp")), f(ev.get("humidity")), f(ev.get("soil")),
                            f(ev.get("lux")), f(e["manual_height_cm"]), f(e["manual_width_cm"]),
                            e["leaf_count"] if e["leaf_count"] is not None else "", acts, e["note"] or "",
                            e["photo"]])
        data = "﻿" + buf.getvalue()  # 엑셀에서 한글이 깨지지 않도록 BOM 추가
        filename = f"jaram_{datetime.now():%Y%m%d}.csv"
        return Response(data, mimetype="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f"attachment; filename={filename}"})

    @app.get("/api/backup.zip")
    def backup():
        """DB + 모든 사진을 zip 하나로. 압축을 풀어 데이터 폴더에 넣으면 그대로 복원돼요."""
        fd, zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)
        db_copy = zip_path + ".db"
        try:
            # 쓰는 중이어도 안전하게 복사되도록 SQLite 백업 기능 사용
            src = sqlite3.connect(app.config["DB_PATH"])
            dst = sqlite3.connect(db_copy)
            with dst:
                src.backup(dst)
            src.close()
            dst.close()
            with zipfile.ZipFile(zip_path, "w") as z:
                z.write(db_copy, "jaram.db", compress_type=zipfile.ZIP_DEFLATED)
                for f in sorted(app.config["UPLOAD_DIR"].rglob("*")):
                    if f.is_file():
                        # 사진은 이미 압축된 형식이라 그대로 저장 (서버 CPU 절약)
                        z.write(f, "uploads/" + f.relative_to(app.config["UPLOAD_DIR"]).as_posix(),
                                compress_type=zipfile.ZIP_STORED)
        finally:
            if os.path.exists(db_copy):
                os.unlink(db_copy)
        response = send_file(zip_path, mimetype="application/zip", as_attachment=True,
                             download_name=f"jaram_backup_{datetime.now():%Y%m%d}.zip")

        @response.call_on_close
        def remove_zip():
            try:
                os.unlink(zip_path)
            except OSError:
                pass

        return response

    # ---------------- 3D 측정 (scans_api.py) ----------------
    scans_api.register(app, SimpleNamespace(
        conn=conn, ApiError=ApiError, get_plant=get_plant, thresholds=thresholds, species_cfg=species_cfg,
        plant_roi=plant_roi, media_url=media_url, now_iso=now_iso, parse_dt=parse_dt, num=num, text=text,
        clean=clean, safe_code=safe_code, remove_files=remove_files, insert_measurement=insert_measurement,
        load_scans=load_scans, upload_dir=app.config["UPLOAD_DIR"], CARE_KINDS=CARE_KINDS,
    ))

    return app


def main():
    parser = argparse.ArgumentParser(description="자람 — 식물 생장 기록 웹앱")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--https", action="store_true",
                        help="자체 서명 인증서로 HTTPS 실행 (휴대폰 실시간 카메라용, cryptography 패키지 필요)")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    app = create_app()
    scheme = "https" if args.https else "http"
    print("\n  🌱 자람 서버가 시작됐어요")
    print(f"     이 컴퓨터:  {scheme}://127.0.0.1:{args.port}")
    print(f"     휴대폰:     {scheme}://{lan_ip()}:{args.port}  (같은 와이파이에 연결)")
    print("     로그인:     " + ("팀 비밀번호 필요" if app.config["PASSWORD"] else "없음 (JARAM_PASSWORD 로 설정 가능)") + "\n")
    app.run(host=args.host, port=args.port, debug=args.debug,
            ssl_context="adhoc" if args.https else None)


if __name__ == "__main__":
    main()
