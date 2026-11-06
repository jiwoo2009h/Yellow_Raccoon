"""SQLite 데이터베이스. 파일 하나(data/jaram.db)에 모든 기록을 저장합니다."""

import json
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS plants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    code        TEXT,
    species     TEXT NOT NULL DEFAULT 'basil',
    cm_per_px   REAL,
    calibration TEXT,
    memo        TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS measurements (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id         INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    taken_at         TEXT NOT NULL,
    photo            TEXT NOT NULL,
    mask             TEXT,
    overlay          TEXT,
    img_w            INTEGER,
    img_h            INTEGER,
    height_px        REAL,
    width_px         REAL,
    area_px          REAL,
    bbox             TEXT,
    hue              REAL,
    sat              REAL,
    val              REAL,
    warnings         TEXT,
    manual_height_cm REAL,
    manual_width_cm  REAL,
    leaf_count       INTEGER,
    note             TEXT,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS env_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id       INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    measurement_id INTEGER REFERENCES measurements(id) ON DELETE CASCADE,
    at             TEXT NOT NULL,
    temp           REAL,
    humidity       REAL,
    soil           REAL,
    lux            REAL
);

CREATE TABLE IF NOT EXISTS care_logs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    at       TEXT NOT NULL,
    kind     TEXT NOT NULL,
    amount   REAL,
    note     TEXT,
    rec_code TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 3D 측정: 여러 각도 사진 한 묶음
CREATE TABLE IF NOT EXISTS scans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id       INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    taken_at       TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft',
    measurement_id INTEGER REFERENCES measurements(id) ON DELETE SET NULL,
    volume_px      REAL,
    height_px      REAL,
    width_px       REAL,
    depth_px       REAL,
    top_area_px    REAL,
    points         TEXT,
    warnings       TEXT,
    detail         TEXT,
    note           TEXT,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_views (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id    INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    angle      REAL,
    photo      TEXT NOT NULL,
    mask       TEXT,
    overlay    TEXT,
    img_w      INTEGER,
    img_h      INTEGER,
    bbox       TEXT,
    area_px    REAL,
    roi        TEXT,
    warnings   TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_m_plant ON measurements(plant_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_scan_plant ON scans(plant_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_view_scan ON scan_views(scan_id);
CREATE INDEX IF NOT EXISTS idx_env_plant ON env_logs(plant_id, at);
CREATE INDEX IF NOT EXISTS idx_care_plant ON care_logs(plant_id, at);
"""


def connect(path):
    conn = sqlite3.connect(path, detect_types=0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# 기존 DB 에 나중에 추가된 칸 (이미 실험 데이터가 있는 DB 도 안전하게 업그레이드)
MIGRATIONS = [
    ("plants", "roi", "TEXT"),
]


def ensure_column(conn, table, column, col_type):
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
        return True
    return False


def init(path):
    conn = connect(path)
    conn.executescript(SCHEMA)
    for table, column, col_type in MIGRATIONS:
        ensure_column(conn, table, column, col_type)
    conn.commit()
    conn.close()


def row(r):
    return dict(r) if r is not None else None


def rows(rs):
    return [dict(r) for r in rs]


def get_setting(conn, key, default=None):
    r = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if r is None:
        return default
    try:
        return json.loads(r["value"])
    except ValueError:
        return default


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value, ensure_ascii=False)),
    )
