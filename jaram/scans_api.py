"""3D 측정 API — 여러 각도 사진 → 실루엣 분석 → 3D 영역(부피) 계산.

흐름
  1. POST /api/plants/<id>/scans            : 측정 초안 만들기 (이 식물의 다른 초안은 지움)
  2. POST /api/scans/<sid>/views            : 사진 한 장 올리기 (kind=side&angle=0|90|180|270 또는 kind=top)
       → 바로 식물 실루엣을 분석해서 확인용 이미지를 돌려줌. 같은 각도를 다시 올리면 바꿔 끼움.
  3. POST /api/scans/<sid>/compute          : 3D 계산 (vision3d.compute_scan) → 부피·높이·폭·깊이·위 면적
       → 0° 사진은 평소 고정 위치 사진이므로 일반 측정 기록(2D)으로도 저장해 매일 기록이 이어지게 함
"""

import csv
import io
import json
import shutil
import uuid
from datetime import datetime

import cv2
from flask import Response, jsonify, request

from growth import days_between
from vision import PlantAnalyzer, PlantNotFoundError, encode_jpeg, encode_png, load_image
from vision3d import ScanError, compute_scan

SIDE_ANGLES = (0, 90, 180, 270)
METHOD_LABELS = {"hull": "시각 헐 (여러 방향 실루엣 교집합)", "ellipse2": "측면 2장 · 단면 타원 근사"}


def scan_summary(sc, media_url):
    """식물 상세·목록용 요약 (growth.scan_series 결과 한 줄)"""
    d = sc.get("delta") or {}
    detail = json.loads(sc["detail"]) if isinstance(sc.get("detail"), str) and sc["detail"] else (sc.get("detail") or {})
    return {
        "id": sc["id"],
        "taken_at": sc["taken_at"],
        "volume": sc["volume"],
        "height": sc.get("height"),
        "width": sc.get("width"),
        "depth": sc.get("depth"),
        "top_area": sc.get("top_area"),
        "method": detail.get("method"),
        "thumb_url": media_url(sc.get("thumb")),
        "points_url": media_url(sc.get("points")),
        "delta": {k: d.get(k) for k in ("days", "volume_pct", "volume_pct_per_day")} if d else None,
        "warnings": json.loads(sc["warnings"]) if isinstance(sc.get("warnings"), str) and sc["warnings"] else [],
    }


def register(app, ctx):
    conn = ctx.conn
    ApiError = ctx.ApiError
    upload_dir = ctx.upload_dir

    # ------------------------------------------------------------ 공통
    def get_scan(sid):
        row = conn().execute("SELECT * FROM scans WHERE id = ?", (sid,)).fetchone()
        if row is None:
            raise ApiError("3D 측정을 찾을 수 없어요.", 404)
        return dict(row)

    def load_views(sid):
        rows = [dict(r) for r in conn().execute("SELECT * FROM scan_views WHERE scan_id = ?", (sid,))]
        rows.sort(key=lambda v: (v["kind"] != "side", v["angle"] if v["angle"] is not None else 999))
        return rows

    def view_json(v):
        return {
            "id": v["id"], "kind": v["kind"], "angle": v["angle"],
            "photo_url": ctx.media_url(v["photo"]), "overlay_url": ctx.media_url(v["overlay"]),
            "img_w": v["img_w"], "img_h": v["img_h"],
            "bbox": json.loads(v["bbox"]) if v["bbox"] else None, "area_px": v["area_px"],
            "roi": json.loads(v["roi"]) if v["roi"] else None,
            "warnings": json.loads(v["warnings"]) if v["warnings"] else [],
        }

    def scan_json(scan):
        plant = ctx.get_plant(scan["plant_id"])
        views = load_views(scan["id"])
        series = ctx.load_scans(plant)
        cur = next((s for s in series if s["id"] == scan["id"]), None)
        idx = series.index(cur) if cur else -1
        prev = series[idx - 1] if cur and idx > 0 else None
        first = series[0] if cur and idx > 0 else None
        detail = json.loads(scan["detail"]) if scan["detail"] else {}
        data = {
            "id": scan["id"], "plant_id": scan["plant_id"], "taken_at": scan["taken_at"], "status": scan["status"],
            "note": scan["note"], "measurement_id": scan["measurement_id"],
            "plant": {"id": plant["id"], "name": plant["name"], "species": plant["species"],
                      "unit": "cm" if plant["cm_per_px"] else "px"},
            "views": [view_json(v) for v in views],
            "warnings": json.loads(scan["warnings"]) if scan["warnings"] else [],
            "detail": detail,
            "method_label": METHOD_LABELS.get(detail.get("method"), None),
            "points_url": ctx.media_url(scan["points"]),
            "index": idx,
        }
        if cur:
            data.update({k: cur[k] for k in ("volume", "height", "width", "depth", "top_area", "delta")})
            data["previous"] = {"id": prev["id"], "taken_at": prev["taken_at"], "volume": prev["volume"]} if prev else None
            if first:
                data["since_first"] = {
                    "days": days_between(first["taken_at"], cur["taken_at"]),
                    "volume_pct": (cur["volume"] / first["volume"] - 1) * 100 if first["volume"] else None,
                }
        # 지난 측정의 같은 각도 사진 (겹쳐 보기용)
        last_done = next((s for s in reversed(series) if s["id"] != scan["id"]), None)
        if last_done:
            data["reference_views"] = {
                (f"a{int(v['angle'])}" if v["kind"] == "side" else "top"): ctx.media_url(v["photo"])
                for v in load_views(last_done["id"])
            }
        return ctx.clean(data)

    def analyze(plant, image, kind, angle, roi):
        cfg = ctx.species_cfg(ctx.thresholds(), plant["species"])
        analyzer = PlantAnalyzer(cfg["hsv_lower"], cfg["hsv_upper"])
        fixed = kind == "side" and angle == 0
        if roi is None and fixed:
            roi = ctx.plant_roi(plant)  # 0°는 평소 고정 위치 → 식물별 분석 영역 사용
        # 손으로 들고 찍은 사진은 뒤쪽에 다른 화분이 섞이기 쉬워 '가운데 덩어리 우선'
        return analyzer.analyze(image, roi=roi, prefer="largest" if fixed else "center")

    def save_view_files(plant, sid, tag, res):
        stem = f"{plant['id']}/scan{sid}_{tag}_{uuid.uuid4().hex[:6]}"
        names = {"photo": f"{stem}.jpg", "mask": f"{stem}_mask.png", "overlay": f"{stem}_overlay.jpg"}
        (upload_dir / str(plant["id"])).mkdir(parents=True, exist_ok=True)
        (upload_dir / names["photo"]).write_bytes(encode_jpeg(res.image, 90))
        (upload_dir / names["mask"]).write_bytes(encode_png(res.mask))
        (upload_dir / names["overlay"]).write_bytes(encode_jpeg(res.overlay, 85))
        return names

    def delete_scan_files(sid):
        for v in conn().execute("SELECT photo, mask, overlay FROM scan_views WHERE scan_id = ?", (sid,)):
            ctx.remove_files(v["photo"], v["mask"], v["overlay"])
        row = conn().execute("SELECT points FROM scans WHERE id = ?", (sid,)).fetchone()
        if row:
            ctx.remove_files(row["points"])

    def parse_roi(value):
        if value in (None, "", "null"):
            return None
        roi = json.loads(value) if isinstance(value, str) else value
        if isinstance(roi, dict):
            roi = [roi.get(k) for k in ("x0", "y0", "x1", "y1")]
        vals = [ctx.num(v, 0, 1, "영역 좌표") for v in roi]
        if None in vals or vals[2] - vals[0] < 0.05 or vals[3] - vals[1] < 0.05:
            raise ApiError("영역이 너무 작아요.")
        return [round(v, 4) for v in vals]

    # ------------------------------------------------------------ 초안 만들기
    @app.post("/api/plants/<int:pid>/scans")
    def create_scan(pid):
        plant = ctx.get_plant(pid)
        body = request.get_json(silent=True) or {}
        for old in conn().execute("SELECT id FROM scans WHERE plant_id = ? AND status = 'draft'", (pid,)).fetchall():
            delete_scan_files(old["id"])
            conn().execute("DELETE FROM scans WHERE id = ?", (old["id"],))
        taken_at = ctx.parse_dt(body.get("taken_at")) or ctx.now_iso()
        cur = conn().execute("INSERT INTO scans(plant_id, taken_at, status, created_at) VALUES(?, ?, 'draft', ?)",
                             (plant["id"], taken_at, ctx.now_iso()))
        conn().commit()
        return jsonify(scan_json(get_scan(cur.lastrowid))), 201

    # ------------------------------------------------------------ 사진 올리기
    @app.post("/api/scans/<int:sid>/views")
    def add_view(sid):
        scan = get_scan(sid)
        plant = ctx.get_plant(scan["plant_id"])
        kind = request.form.get("kind", "side")
        if kind not in ("side", "top"):
            raise ApiError("사진 종류가 올바르지 않아요.")
        angle = None
        if kind == "side":
            angle = ctx.num(request.form.get("angle"), 0, 359, "각도")
            if angle is None or int(angle) not in SIDE_ANGLES:
                raise ApiError("측면 각도는 0, 90, 180, 270 중 하나여야 해요.")
            angle = float(int(angle))
        f = request.files.get("photo")
        if f is None:
            raise ApiError("사진을 선택해 주세요.")
        try:
            image = load_image(f.read())
        except ValueError as exc:
            raise ApiError(str(exc)) from exc
        roi = parse_roi(request.form.get("roi"))
        try:
            res = analyze(plant, image, kind, angle, roi)
        except PlantNotFoundError as exc:
            raise ApiError(str(exc), 422) from exc
        # 같은 각도 사진이 있으면 바꿔 끼움
        q = "SELECT * FROM scan_views WHERE scan_id = ? AND kind = ? AND " + ("angle = ?" if kind == "side" else "angle IS NULL")
        args = (sid, kind, angle) if kind == "side" else (sid, kind)
        for old in conn().execute(q, args).fetchall():
            ctx.remove_files(old["photo"], old["mask"], old["overlay"])
            conn().execute("DELETE FROM scan_views WHERE id = ?", (old["id"],))
        tag = f"a{int(angle)}" if kind == "side" else "top"
        names = save_view_files(plant, sid, tag, res)
        m = res.metrics()
        conn().execute(
            """INSERT INTO scan_views(scan_id, kind, angle, photo, mask, overlay, img_w, img_h, bbox, area_px,
                   roi, warnings, metrics, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (sid, kind, angle, names["photo"], names["mask"], names["overlay"], m["img_w"], m["img_h"],
             json.dumps(m["bbox"]), m["area_px"], json.dumps(roi) if roi else None,
             json.dumps(m["warnings"], ensure_ascii=False), json.dumps(m, ensure_ascii=False), ctx.now_iso()))
        if scan["status"] == "done":
            conn().execute("UPDATE scans SET status = 'draft' WHERE id = ?", (sid,))  # 다시 계산 필요
        conn().commit()
        return jsonify(scan_json(get_scan(sid))), 201

    @app.patch("/api/scans/<int:sid>/views/<int:vid>")
    def update_view(sid, vid):
        """사진별 영역을 바꿔 다시 분석 (다른 화분이 섞였을 때)"""
        scan = get_scan(sid)
        plant = ctx.get_plant(scan["plant_id"])
        v = conn().execute("SELECT * FROM scan_views WHERE id = ? AND scan_id = ?", (vid, sid)).fetchone()
        if v is None:
            raise ApiError("사진을 찾을 수 없어요.", 404)
        roi = parse_roi((request.get_json(silent=True) or {}).get("roi"))
        try:
            res = analyze(plant, load_image((upload_dir / v["photo"]).read_bytes()), v["kind"], v["angle"], roi)
        except PlantNotFoundError as exc:
            raise ApiError(str(exc), 422) from exc
        tag = (f"a{int(v['angle'])}" if v["kind"] == "side" else "top") + "r"
        stem = f"{plant['id']}/scan{sid}_{tag}_{uuid.uuid4().hex[:6]}"
        mask, overlay = f"{stem}_mask.png", f"{stem}_overlay.jpg"
        (upload_dir / mask).write_bytes(encode_png(res.mask))
        (upload_dir / overlay).write_bytes(encode_jpeg(res.overlay, 85))
        ctx.remove_files(v["mask"], v["overlay"])
        m = res.metrics()
        conn().execute(
            "UPDATE scan_views SET mask = ?, overlay = ?, bbox = ?, area_px = ?, roi = ?, warnings = ?, metrics = ? WHERE id = ?",
            (mask, overlay, json.dumps(m["bbox"]), m["area_px"], json.dumps(roi) if roi else None,
             json.dumps(m["warnings"], ensure_ascii=False), json.dumps(m, ensure_ascii=False), vid))
        conn().execute("UPDATE scans SET status = 'draft' WHERE id = ? AND status = 'done'", (sid,))
        conn().commit()
        return jsonify(scan_json(get_scan(sid)))

    @app.delete("/api/scans/<int:sid>/views/<int:vid>")
    def delete_view(sid, vid):
        get_scan(sid)
        v = conn().execute("SELECT * FROM scan_views WHERE id = ? AND scan_id = ?", (vid, sid)).fetchone()
        if v is None:
            raise ApiError("사진을 찾을 수 없어요.", 404)
        ctx.remove_files(v["photo"], v["mask"], v["overlay"])
        conn().execute("DELETE FROM scan_views WHERE id = ?", (vid,))
        conn().commit()
        return jsonify(scan_json(get_scan(sid)))

    # ------------------------------------------------------------ 3D 계산
    @app.post("/api/scans/<int:sid>/compute")
    def compute(sid):
        scan = get_scan(sid)
        plant = ctx.get_plant(scan["plant_id"])
        views = load_views(sid)
        sides, top = [], None
        for v in views:
            mask = cv2.imread(str(upload_dir / v["mask"]), cv2.IMREAD_GRAYSCALE)
            if mask is None:
                raise ApiError(f"{v['angle']:g}° 사진의 분석 결과를 읽을 수 없어요. 다시 찍어 주세요.")
            if v["kind"] == "side":
                sides.append((v["angle"], mask))
            else:
                top = mask
        if not any(a == 0 for a, _ in sides):
            raise ApiError("0°(정면) 사진이 필요해요.")
        try:
            res = compute_scan(sides, top)
        except ScanError as exc:
            raise ApiError(str(exc), 422) from exc

        points_name = f"{plant['id']}/scan{sid}_points_{uuid.uuid4().hex[:6]}.json"
        (upload_dir / points_name).write_text(json.dumps(res["points"], separators=(",", ":")))
        ctx.remove_files(scan["points"])
        detail = {**res["detail"], "method": res["method"]}

        # 0° 사진은 일반 측정 기록(2D)으로도 저장 (이미 있으면 그대로)
        mid = scan["measurement_id"]
        if mid is None or conn().execute("SELECT 1 FROM measurements WHERE id = ?", (mid,)).fetchone() is None:
            v0 = next(v for v in views if v["kind"] == "side" and v["angle"] == 0)
            stem = f"{plant['id']}/{ctx.safe_code(plant['code']) or 'P' + str(plant['id'])}_" \
                   f"{datetime.fromisoformat(scan['taken_at']):%Y%m%d-%H%M%S}_{uuid.uuid4().hex[:6]}"
            names = {"photo": f"{stem}.jpg", "mask": f"{stem}_mask.png", "overlay": f"{stem}_overlay.jpg"}
            for key in names:
                shutil.copyfile(upload_dir / v0[key], upload_dir / names[key])
            mid = ctx.insert_measurement(plant["id"], names, json.loads(v0["metrics"]), scan["taken_at"])

        conn().execute(
            """UPDATE scans SET status = 'done', volume_px = ?, height_px = ?, width_px = ?, depth_px = ?,
                   top_area_px = ?, points = ?, warnings = ?, detail = ?, measurement_id = ? WHERE id = ?""",
            (res["volume_px"], res["height_px"], res["width_px"], res["depth_px"], res["top_area_px"], points_name,
             json.dumps(res["warnings"], ensure_ascii=False), json.dumps(detail, ensure_ascii=False), mid, sid))
        conn().commit()
        return jsonify(scan_json(get_scan(sid)))

    # ------------------------------------------------------------ 조회·수정·삭제
    @app.get("/api/scans/<int:sid>")
    def get_one(sid):
        return jsonify(scan_json(get_scan(sid)))

    @app.patch("/api/scans/<int:sid>")
    def update_scan(sid):
        get_scan(sid)
        body = request.get_json(silent=True) or {}
        fields = {}
        if "note" in body:
            fields["note"] = ctx.text(body["note"], 300, "메모")
        if "taken_at" in body:
            t = ctx.parse_dt(body["taken_at"])
            if t:
                fields["taken_at"] = t
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn().execute(f"UPDATE scans SET {sets} WHERE id = ?", (*fields.values(), sid))
            conn().commit()
        return jsonify(scan_json(get_scan(sid)))

    @app.delete("/api/scans/<int:sid>")
    def delete_scan(sid):
        get_scan(sid)
        delete_scan_files(sid)
        conn().execute("DELETE FROM scans WHERE id = ?", (sid,))
        conn().commit()
        return jsonify(ok=True)

    @app.get("/api/export_scans.csv")
    def export_scans():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["날짜", "식물ID", "식물 이름", "부피", "높이", "폭", "깊이", "위에서 본 면적", "단위",
                    "부피 변화(%)", "부피 생장률(%/일)", "측면 사진 수", "위 사진 사용", "계산 방법", "경고"])
        for p in [dict(r) for r in conn().execute("SELECT * FROM plants ORDER BY id")]:
            unit = "cm" if p["cm_per_px"] else "px"
            for sc in ctx.load_scans(p):
                detail = json.loads(sc["detail"]) if sc["detail"] else {}
                d = sc["delta"] or {}

                def f(v, digits=3):
                    return "" if v is None else round(v, digits)

                top = detail.get("top") or {}
                w.writerow([sc["taken_at"].replace("T", " "), p["code"] or p["id"], p["name"],
                            f(sc["volume"]), f(sc["height"]), f(sc["width"]), f(sc["depth"]), f(sc["top_area"]),
                            unit, f(d.get("volume_pct")), f(d.get("volume_pct_per_day")),
                            len(detail.get("views", [])), "예" if top.get("used") else "아니요",
                            METHOD_LABELS.get(detail.get("method"), ""), " / ".join(json.loads(sc["warnings"] or "[]"))])
        return Response("﻿" + buf.getvalue(), mimetype="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f"attachment; filename=jaram_3d_{datetime.now():%Y%m%d}.csv"})
