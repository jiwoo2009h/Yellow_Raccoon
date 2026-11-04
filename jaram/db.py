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

CREATE INDEX IF NOT EXISTS idx_m_plant ON measurements(plant_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_env_plant ON env_logs(plant_id, at);
CREATE INDEX IF NOT EXISTS idx_care_plant ON care_logs(plant_id, at);
"""


def connect(path):
    conn = sqlite3.connect(path, detect_types=0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init(path):
    conn = connect(path)
    conn.executescript(SCHEMA)
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
