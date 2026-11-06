"""데모 데이터 만들기.

실제 실험 데이터가 쌓이기 전에 앱이 어떻게 동작하는지 보기 위한 스크립트입니다.
합성(가짜) 식물 사진을 그려서 바질 2개, 상추 2개의 2주치 기록을 만듭니다.

    python seed_demo.py              # data-demo 폴더에 데모 DB 생성
    JARAM_DATA=data-demo python app.py   # 데모 데이터로 서버 실행 (Windows: set JARAM_DATA=data-demo)

⚠ 실제 실험 데이터(data 폴더)와 섞이지 않도록 기본으로 data-demo 폴더를 씁니다.
"""

import argparse
import io
import math
import shutil
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np


def draw_plant(size, species="basil", seed=0, width=960, height=1280, light=1.0, hue_shift=0, ruler=True,
               noise_seed=None):
    """합성 식물 사진 (BGR). size 가 클수록 잎이 크고 많아집니다."""
    rng = np.random.default_rng(seed)
    img = np.zeros((height, width, 3), np.uint8)
    # 배경: 위는 밝은 벽, 아래는 책상
    for y in range(height):
        t = y / height
        img[y, :] = (232 - 18 * t, 236 - 16 * t, 240 - 12 * t)
    img[int(height * 0.78):, :] = (196, 206, 214)
    # 화분
    pot_top, pot_w = int(height * 0.68), int(width * 0.34)
    cx = width // 2
    pts = np.array([[cx - pot_w // 2, pot_top], [cx + pot_w // 2, pot_top],
                    [cx + pot_w // 2 - 40, int(height * 0.9)], [cx - pot_w // 2 + 40, int(height * 0.9)]])
    cv2.fillPoly(img, [pts], (70, 100, 170))
    cv2.rectangle(img, (cx - pot_w // 2 - 10, pot_top - 18), (cx + pot_w // 2 + 10, pot_top + 10), (60, 88, 150), -1)
    cv2.ellipse(img, (cx, pot_top - 10), (pot_w // 2, 14), 0, 0, 360, (40, 52, 70), -1)
    # 자 (기준물): 10cm = 400px 로 그림
    if ruler:
        rx = int(width * 0.86)
        cv2.rectangle(img, (rx, int(height * 0.25)), (rx + 46, int(height * 0.25) + 440), (80, 205, 240), -1)
        for i in range(0, 101):
            y = int(height * 0.25) + 20 + i * 4
            ln = 22 if i % 10 == 0 else (14 if i % 5 == 0 else 8)
            cv2.line(img, (rx, y), (rx + ln, y), (30, 30, 30), 1)

    base_y = pot_top - 14
    # 잎 배치는 식물마다 고정(seed), 크기만 size 에 따라 연속적으로 커집니다.
    if species == "lettuce":
        color = np.array([95, 205, 140], float)  # 밝은 연두 (BGR)
        total = 11
        n_f = 4 + size * 7  # 소수점 = 마지막 잎이 자라는 중
        order = [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10]  # 가운데 잎부터 바깥쪽으로 자람
        for i in range(total):
            ang = -math.pi / 2 + (order[i] / (total - 1) - 0.5) * math.pi * 1.1 + rng.normal(0, 0.08)
            jitter, tone = 0.8 + 0.3 * rng.random(), 0.85 + 0.25 * rng.random()
            grow = min(1.0, max(0.0, n_f - i))
            if grow <= 0.05:
                continue
            length = (60 + 170 * size) * jitter * (0.4 + 0.6 * grow)
            lx = int(cx + math.cos(ang) * length * 0.55)
            ly = int(base_y + math.sin(ang) * length * 0.55)
            axes = (int(length * 0.42), int(length * 0.3))
            cv2.ellipse(img, (lx, ly), axes, math.degrees(ang), 0, 360, (color * tone).tolist(), -1, cv2.LINE_AA)
    else:
        color = np.array([45, 140, 55], float)  # 진한 초록 (BGR)
        stem_h = int(80 + 330 * size)
        cv2.line(img, (cx, base_y), (cx, base_y - stem_h), (60, 120, 70), 7, cv2.LINE_AA)
        total = 7
        pairs_f = 2 + size * 4
        for i in range(total):
            jitter = [0.85 + 0.3 * rng.random() for _ in range(3)]
            grow = min(1.0, max(0.0, pairs_f - i))
            if grow <= 0.05:
                continue
            y = base_y - int(stem_h * (i + 1) / (pairs_f + 0.3))
            leaf = (35 + 75 * size) * (1 - i / (pairs_f + 2)) * jitter[0] * (0.4 + 0.6 * grow)
            for k, side in enumerate((-1, 1)):
                lx = int(cx + side * leaf * 0.9)
                cv2.ellipse(img, (lx, y), (int(leaf), int(leaf * 0.55)), side * -20, 0, 360,
                            (color * jitter[k + 1]).tolist(), -1, cv2.LINE_AA)
        cv2.ellipse(img, (cx, base_y - stem_h - 10), (int(20 + 30 * size), int(16 + 22 * size)), 0, 0, 360,
                    (color * 1.1).tolist(), -1, cv2.LINE_AA)

    if hue_shift:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.int16)
        green = (hsv[..., 0] > 30) & (hsv[..., 0] < 95) & (hsv[..., 1] > 60)
        hsv[..., 0][green] = np.clip(hsv[..., 0][green] - hue_shift, 0, 179)
        img = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    noise = np.random.default_rng(noise_seed).normal(0, 3, img.shape)
    img = np.clip(img.astype(float) * light + noise, 0, 255).astype(np.uint8)
    return img


# ---------------------------------------------------------------- 3D 합성 식물 (여러 각도 사진용)
def plant_model(size, species="basil", seed=0):
    """합성 3D 식물: [(x, 높이, z, a, b, c, 방향°, 밝기)] — 잎·줄기를 타원체로 표현 (0° 사진 픽셀 단위).

    a: 잎 길이 방향 반지름, b: 세로 반지름, c: 잎 폭 방향 반지름, 방향: 위에서 본 잎의 방향.
    바질은 잎이 마주나고 층마다 90°씩 돌아가며(십자마주나기), 상추는 황금각(137.5°)으로 둘러나는 로제트.
    """
    rng = np.random.default_rng(seed)
    parts = []
    if species == "lettuce":
        total = 11
        n_f = 4 + size * 7
        for i in range(total):
            yaw = (i * 137.5 + rng.normal(0, 8)) % 360
            jitter, tone = 0.8 + 0.3 * rng.random(), 0.85 + 0.25 * rng.random()
            grow = min(1.0, max(0.0, n_f - i))
            if grow <= 0.05:
                continue
            a = (60 + 170 * size) * jitter * (0.4 + 0.6 * grow) * 0.42
            # 잎이 비스듬히 위로 퍼지는 모양: 중심을 조금 띄우고 세로로 길게
            r = a * 0.6
            rad = math.radians(yaw)
            parts.append((r * math.cos(rad), a * 0.7 + 6, r * math.sin(rad), a, a * 0.75, a * 0.6, yaw, tone))
    else:
        stem_h = 80 + 330 * size
        for t in np.arange(0, stem_h, 14):
            parts.append((0.0, float(t) + 7, 0.0, 4.0, 8.0, 4.0, 0.0, 0.8))
        total = 7
        pairs_f = 2 + size * 4
        for i in range(total):
            jitter = [0.85 + 0.3 * rng.random() for _ in range(3)]
            grow = min(1.0, max(0.0, pairs_f - i))
            base_yaw = (i % 2) * 90 + rng.normal(0, 6)
            if grow <= 0.05:
                continue
            y = stem_h * (i + 1) / (pairs_f + 0.3)
            leaf = (35 + 75 * size) * (1 - i / (pairs_f + 2)) * jitter[0] * (0.4 + 0.6 * grow)
            for k, side in enumerate((0, 180)):
                yaw = base_yaw + side
                rad = math.radians(yaw)
                parts.append((leaf * 0.9 * math.cos(rad), y, leaf * 0.9 * math.sin(rad), leaf, leaf * 0.42, leaf * 0.55,
                              yaw, jitter[k + 1]))
        parts.append((0.0, stem_h + 10, 0.0, 20 + 30 * size, 16 + 22 * size, 20 + 30 * size, 0.0, 1.1))
    return parts


def _leaf_color(species):
    return np.array([95, 205, 140], float) if species == "lettuce" else np.array([45, 140, 55], float)


def render_plant_view(parts, species="basil", angle=0, scale=1.0, shift=0.0, ruler=False, width=960, height=1280,
                      noise_seed=None, neighbor=False):
    """3D 모델을 수평 방향 angle 에서 본 컬러 사진 (손촬영 흉내: scale·shift)"""
    img = np.zeros((height, width, 3), np.uint8)
    for y in range(height):
        t = y / height
        img[y, :] = (232 - 18 * t, 236 - 16 * t, 240 - 12 * t)
    img[int(height * 0.78):, :] = (196, 206, 214)
    if neighbor:  # 뒤쪽에 보이는 다른 화분의 잎 (가운데 식물만 골라야 함)
        cv2.ellipse(img, (10, int(height * 0.46)), (80, 150), 0, 0, 360, (50, 150, 60), -1, cv2.LINE_AA)
    cx = width / 2 + shift
    pot_top = height * 0.68
    base_y = pot_top - 14
    pw = width * 0.34 * scale

    def P(x, y):  # 바닥 기준점 주변으로 배율 적용
        return int(round(cx + x)), int(round(base_y + (y - base_y) * scale))

    pts = np.array([P(-pw / 2, pot_top), P(pw / 2, pot_top), P(pw / 2 - 40 * scale, height * 0.9), P(-pw / 2 + 40 * scale, height * 0.9)])
    cv2.fillPoly(img, [pts], (70, 100, 170))
    cv2.rectangle(img, P(-pw / 2 - 10 * scale, pot_top - 18 * scale), P(pw / 2 + 10 * scale, pot_top + 10 * scale), (60, 88, 150), -1)
    cv2.ellipse(img, P(0, pot_top - 10 * scale), (int(pw / 2), max(1, int(14 * scale))), 0, 0, 360, (40, 52, 70), -1)
    if ruler:
        rx = int(width * 0.86)
        cv2.rectangle(img, (rx, int(height * 0.25)), (rx + 46, int(height * 0.25) + 440), (80, 205, 240), -1)
        for i in range(0, 101):
            y = int(height * 0.25) + 20 + i * 4
            ln = 22 if i % 10 == 0 else (14 if i % 5 == 0 else 8)
            cv2.line(img, (rx, y), (rx + ln, y), (30, 30, 30), 1)
    th = math.radians(angle)
    color = _leaf_color(species)
    # 멀리 있는 잎부터 그림
    order = sorted(parts, key=lambda q: -(-q[0] * math.sin(th) + q[2] * math.cos(th)))
    for x, y, z, a, b, c, yaw, tone in order:
        u = x * math.cos(th) + z * math.sin(th)
        phi = math.radians(yaw)
        half = math.sqrt((a * math.cos(phi - th)) ** 2 + (c * math.sin(phi - th)) ** 2)
        center = (int(round(cx + u * scale)), int(round(base_y - y * scale)))
        cv2.ellipse(img, center, (max(1, int(round(half * scale))), max(1, int(round(b * scale)))), 0, 0, 360,
                    (color * tone).clip(0, 255).tolist(), -1, cv2.LINE_AA)
    noise = np.random.default_rng(noise_seed).normal(0, 3, img.shape)
    return np.clip(img.astype(float) + noise, 0, 255).astype(np.uint8)


def render_plant_top(parts, species="basil", scale=0.85, width=960, height=1280, noise_seed=None):
    """위에서 내려다본 사진 (열 = X, 행 = Z)"""
    img = np.zeros((height, width, 3), np.uint8)
    img[:, :] = (196, 206, 214)
    cx, cy = width / 2, height / 2
    r = width * 0.17 * scale
    cv2.circle(img, (int(cx), int(cy)), int(r + 10 * scale), (60, 88, 150), -1, cv2.LINE_AA)
    cv2.circle(img, (int(cx), int(cy)), int(r), (40, 52, 70), -1, cv2.LINE_AA)
    color = _leaf_color(species)
    for x, y, z, a, b, c, yaw, tone in sorted(parts, key=lambda q: q[1]):
        cv2.ellipse(img, (int(round(cx + x * scale)), int(round(cy + z * scale))),
                    (max(1, int(round(a * scale))), max(1, int(round(c * scale)))), yaw, 0, 360,
                    (color * tone * (0.9 + 0.2 * min(1, y / 300))).clip(0, 255).tolist(), -1, cv2.LINE_AA)
    noise = np.random.default_rng(noise_seed).normal(0, 3, img.shape)
    return np.clip(img.astype(float) + noise, 0, 255).astype(np.uint8)


def jpeg_bytes(img):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return buf.tobytes()


# 식물별 시나리오: 일차 -> (크기, 환경, 관리)
PLANTS = [
    # 바질 1: 정상 생육. 10일째 흙이 말라 생장이 잠깐 느려졌다가, 물주기 추천을 따른 뒤 회복 (추천 효과 검증용)
    {"name": "바질 1", "code": "B1", "species": "basil",
     "growth": lambda d: (0.18 + 0.05 * d if d <= 8 else
                          0.58 + 0.008 * (d - 8) if d <= 10 else
                          0.596 + (0.88 - 0.596) * (d - 10) / 4),
     "env": lambda d: {"temp": 23 + (d % 3) * 0.6, "humidity": 55,
                       "soil": {8: 31, 10: 20, 11: 58}.get(d, 55 - (d % 3) * 8), "lux": 12000}},
    # 바질 2: 후반에 흙이 마르면서 생장 둔화 -> 물주기 추천
    {"name": "바질 2", "code": "B2", "species": "basil",
     "growth": lambda d: 0.16 + 0.05 * min(d, 9) + 0.006 * max(0, d - 9),
     "env": lambda d: {"temp": 23.5, "humidity": 52, "soil": max(14, 58 - 3.4 * d), "lux": 11500}},
    # 상추 1: 조도가 낮아지며 생장 둔화 -> 광환경 확인 추천
    {"name": "상추 1", "code": "L1", "species": "lettuce",
     "growth": lambda d: 0.2 + 0.045 * min(d, 10) + 0.006 * max(0, d - 10),
     "env": lambda d: {"temp": 19, "humidity": 62, "soil": 60 - (d % 2) * 6, "lux": 9000 if d < 10 else 3200}},
    # 상추 2: 온도가 높지만 아직 생장은 유지 -> 관찰
    {"name": "상추 2", "code": "L2", "species": "lettuce",
     "growth": lambda d: 0.18 + 0.05 * d,
     "env": lambda d: {"temp": 22 if d < 10 else 27.5, "humidity": 64, "soil": 62 - (d % 2) * 5, "lux": 9500}},
]
DAYS = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12, 14]
SCAN_DAYS = (0, 7, 14)  # 3D 측정(측면 4장 + 위 1장)을 하는 날


def seed(data_dir):
    from app import create_app

    data_dir = Path(data_dir)
    if data_dir.exists():
        shutil.rmtree(data_dir)
    app = create_app(data_dir)
    client = app.test_client()
    start = (datetime.now() - timedelta(days=DAYS[-1])).replace(hour=9, minute=30, second=0, microsecond=0)

    for idx, spec in enumerate(PLANTS):
        res = client.post("/api/plants", json={"name": spec["name"], "code": spec["code"], "species": spec["species"]})
        pid = res.get_json()["id"]
        first_mid = None
        rng = np.random.default_rng(idx)
        for day in DAYS:
            at = start + timedelta(days=day, minutes=idx * 3)
            parts = plant_model(spec["growth"](day), spec["species"], seed=idx * 100)
            front = render_plant_view(parts, spec["species"], 0, ruler=True, noise_seed=day)
            if day in SCAN_DAYS:
                # 3D 측정: 0°는 평소 고정 위치, 나머지는 손으로 들고 찍은 것처럼 거리·위치가 조금씩 다름
                sid = client.post(f"/api/plants/{pid}/scans", json={"taken_at": at.isoformat()}).get_json()["id"]
                shots = [("side", 0, front)]
                for ang in (90, 180, 270):
                    shots.append(("side", ang, render_plant_view(
                        parts, spec["species"], ang, scale=float(rng.uniform(0.8, 1.2)),
                        shift=float(rng.uniform(-60, 60)), noise_seed=day * 10 + ang, neighbor=ang == 180)))
                shots.append(("top", None, render_plant_top(parts, spec["species"], scale=float(rng.uniform(0.7, 0.95)),
                                                            noise_seed=day + 99)))
                for kind, ang, img in shots:
                    form = {"kind": kind, "photo": (io.BytesIO(jpeg_bytes(img)), f"{spec['code']}_{day}_{kind}{ang}.jpg")}
                    if ang is not None:
                        form["angle"] = str(ang)
                    r = client.post(f"/api/scans/{sid}/views", data=form, content_type="multipart/form-data")
                    assert r.status_code == 201, r.get_json()
                done = client.post(f"/api/scans/{sid}/compute").get_json()
                assert done.get("status") == "done", done
                mid = done["measurement_id"]
                body = client.get(f"/api/measurements/{mid}").get_json()
            else:
                res = client.post(f"/api/plants/{pid}/measurements",
                                  data={"taken_at": at.isoformat(), "photo": (io.BytesIO(jpeg_bytes(front)), f"{spec['code']}_{day}.jpg")},
                                  content_type="multipart/form-data")
                body = res.get_json()
                assert res.status_code == 201, body
                mid = body["measurement"]["id"]
            first_mid = first_mid or mid
            patch = {"env": spec["env"](day)}
            if day in (0, 7, 14):
                patch["manual_height_cm"] = round(body["measurement"]["height_px"] / 40 * (1 + 0.04 * ((day % 3) - 1)), 1)
                patch["manual_width_cm"] = round(body["measurement"]["width_px"] / 40 * 1.02, 1)
            client.patch(f"/api/measurements/{mid}", json=patch)
            if spec["code"] == "B1" and day in (1, 4, 10, 12):
                client.post(f"/api/plants/{pid}/care",
                            json={"kind": "water", "amount": 150, "at": (at + timedelta(hours=1)).isoformat()})
            if spec["code"] in ("L1", "L2") and day in (1, 4, 8, 11):
                client.post(f"/api/plants/{pid}/care",
                            json={"kind": "water", "amount": 150, "at": (at + timedelta(hours=1)).isoformat()})
            if spec["code"] == "B2" and day in (1, 5):
                client.post(f"/api/plants/{pid}/care",
                            json={"kind": "water", "amount": 120, "at": (at + timedelta(hours=1)).isoformat()})
        # 자 보정: 그림의 자 10cm = 세로 400px(원본 1280px 기준). 서버에 저장된 사진도 긴 변 1280px.
        client.patch(f"/api/plants/{pid}", json={"calibration": {
            "x1": 845, "y1": 340, "x2": 845, "y2": 740, "length_cm": 10, "measurement_id": first_mid}})
    print(f"데모 데이터를 만들었어요: {data_dir.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default=str(Path(__file__).resolve().parent / "data-demo"))
    seed(parser.parse_args().data)
