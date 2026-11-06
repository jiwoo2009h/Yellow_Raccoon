"""여러 각도 사진으로 식물의 3D 영역(시각 헐, visual hull)을 계산합니다.

원리 (공간 조각, space carving)
  식물을 둘러싼 3차원 격자(복셀)를 만들고, 각 사진의 식물 실루엣을 그 방향으로 격자에 투영해
  '모든 사진에서 식물 안쪽인 칸'만 남깁니다. 남은 칸의 부피가 3D 부피 추정값입니다.

촬영 가정 (손으로 들고 식물 주위를 돌며 찍기)
  - 0°(정면)는 평소 고정 위치에서 찍은 사진 → 이 사진의 픽셀 크기가 기준이며, 자 보정값(cm/px)으로 cm 환산
  - 90°/180°/270° 는 사람이 식물 주위를 돌며 비슷한 높이에서 찍음 → 거리·위치가 사진마다 다름
  - 위(선택)는 정면 방향이 사진 아래쪽에 오도록 내려다보며 찍음

손촬영 보정
  1) 높이 맞추기: 식물을 수직축으로 돌려 봐도 '맨 위'와 '맨 아래'는 같은 높이이므로,
     각 측면 실루엣의 세로 길이를 0° 사진과 같게 확대·축소하고 바닥을 맞춥니다.
  2) 회전축 맞추기: 실루엣 아래쪽(줄기·화분 중심)으로 축을 추정한 뒤, 폭의 ±15% 범위에서
     헐 부피가 가장 커지는 위치를 찾습니다(어긋나면 서로 깎아 먹어 부피가 줄어들기 때문).
  3) 위 사진: 옆 사진으로 만든 헐을 위에서 본 모양과 가장 잘 겹치는 방향(회전 4 × 좌우반전 2)과
     배율·위치를 골라 함께 깎습니다. 잘 안 맞으면 경고하고 위 사진은 빼고 계산합니다.

한계
  - 오목한 부분(잎 사이 빈 곳)은 실루엣으로 보이지 않아 채워지므로 실제보다 크게 나옵니다.
    → 절댓값보다 같은 방식으로 찍은 측정끼리의 '변화율'이 더 믿을 만합니다.
  - 원근(가까울수록 크게 보임)과 기울어짐은 무시하는 직교 투영 근사입니다.
"""

import math

import cv2
import numpy as np

GRID = 96          # 최종 계산 격자 (긴 변 칸 수)
GRID_COARSE = 40   # 정렬 탐색용 거친 격자
SEARCH = 0.15      # 회전축 탐색 범위 (실루엣 폭 대비)
MAX_POINTS = 5000  # 3D 미리보기 점 개수 상한


class ScanError(ValueError):
    """3D 계산을 할 수 없을 때 (사진 부족, 식물 없음 등)."""


class _Side:
    def __init__(self, angle, sil, raw_box):
        self.angle = float(angle)
        self.sil = sil              # bool (H0 × W) — 높이를 기준 사진에 맞춘 실루엣
        self.raw_box = raw_box      # 원래 사진에서의 경계 상자 (x, y, w, h)
        self.scale = 1.0
        self.u = _axis_guess(sil)   # 회전축 열 위치 (실루엣 좌표)
        self.offset = 0.0


def _crop(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        raise ScanError("사진에서 식물을 찾지 못했어요.")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return mask[y0:y1, x0:x1] > 0, (int(x0), int(y0), int(x1 - x0), int(y1 - y0))


def _resize_bool(arr, w, h):
    out = cv2.resize(arr.astype(np.float32), (max(1, int(round(w))), max(1, int(round(h)))), interpolation=cv2.INTER_AREA)
    return out >= 0.5


def _axis_guess(sil):
    h = sil.shape[0]
    band = sil[int(h * 0.85):]
    xs = np.nonzero(band)[1]
    if len(xs) < 3:
        xs = np.nonzero(sil)[1]
    return float(np.median(xs)) + 0.5


def _row_span(sil):
    """각 행의 실루엣 폭 (가장 왼쪽~오른쪽 칸 수)"""
    any_row = sil.any(axis=1)
    left = np.argmax(sil, axis=1)
    right = sil.shape[1] - np.argmax(sil[:, ::-1], axis=1)
    return np.where(any_row, right - left, 0)


ORIENTS = [  # 위 사진 (열, 행) ← 세계 (X, Z) 대응 8가지
    lambda X, Z: (X, Z), lambda X, Z: (-Z, X), lambda X, Z: (-X, -Z), lambda X, Z: (Z, -X),
    lambda X, Z: (-X, Z), lambda X, Z: (Z, X), lambda X, Z: (X, -Z), lambda X, Z: (-Z, -X),
]


class _Grid:
    def __init__(self, extent, height, n):
        self.vs = max(2 * extent, height) / n
        nxz = max(2, int(math.ceil(2 * extent / self.vs)))
        ny = max(2, int(math.ceil(height / self.vs)))
        self.xs = (np.arange(nxz) + 0.5) * self.vs - nxz * self.vs / 2
        self.zs = self.xs.copy()
        self.ys = (np.arange(ny) + 0.5) * self.vs  # 위에서부터 잰 높이(실루엣 행)
        self.X, self.Z = np.meshgrid(self.xs, self.zs, indexing="ij")


def _carve_sides(sides, grid, height):
    rows = np.clip(grid.ys.astype(int), 0, height - 1)
    occ = np.ones((len(rows), grid.X.shape[0], grid.X.shape[1]), dtype=bool)
    for v in sides:
        th = math.radians(v.angle)
        col = v.u + v.offset + grid.X * math.cos(th) + grid.Z * math.sin(th)
        ci = np.floor(col).astype(int)
        valid = (ci >= 0) & (ci < v.sil.shape[1])
        occ &= v.sil[rows][:, np.clip(ci, 0, v.sil.shape[1] - 1)] & valid[None]
        if not occ.any():
            break
    return occ


def _top_lookup(top, grid, orient, scale, cx, cz):
    """세계 (X, Z) 격자 위치가 위 사진 실루엣 안쪽인지 (nx × nz bool)"""
    a, b = ORIENTS[orient](grid.X, grid.Z)
    col = np.floor(cx + a / scale).astype(int)
    row = np.floor(cz + b / scale).astype(int)
    valid = (col >= 0) & (col < top.shape[1]) & (row >= 0) & (row < top.shape[0])
    return top[np.clip(row, 0, top.shape[0] - 1), np.clip(col, 0, top.shape[1] - 1)] & valid


def _best_offset(values, score):
    """점수가 최대인 후보 (같으면 0 에 가까운 쪽)"""
    scores = [score(v) for v in values]
    best = max(scores)
    tied = [v for v, s in zip(values, scores) if s >= best * (1 - 1e-9)]
    return min(tied, key=abs), best


def compute_scan(side_masks, top_mask=None, grid=GRID):
    """side_masks: [(각도°, 마스크), ...] — 0° 포함 필수. top_mask: 위에서 본 마스크(선택).

    반환 값의 길이·부피는 0° 사진의 픽셀 단위입니다 (cm 환산은 자 보정값으로).
    """
    if not side_masks:
        raise ScanError("측면 사진이 없어요.")
    by_angle = sorted(((float(a) % 360, m) for a, m in side_masks), key=lambda t: t[0])
    if by_angle[0][0] != 0:
        raise ScanError("0°(정면) 사진이 필요해요.")
    dirs = {round(a % 180) for a, _ in by_angle}
    if not any(abs(((d1 - d0 + 90) % 180) - 90) >= 45 for d0 in dirs for d1 in dirs):
        raise ScanError("서로 수직인 방향(예: 0°와 90°)의 사진이 최소 한 장씩 필요해요.")

    warnings = []
    crops = [(a, *_crop(m), m.shape) for a, m in by_angle]
    height = crops[0][2][3]  # 0° 실루엣 높이 = 기준
    if height < 20:
        raise ScanError("0° 사진의 식물이 너무 작게 찍혔어요.")
    sides = []
    for a, sil, box, shape in crops:
        s = height / box[3]
        v = _Side(a, _resize_bool(sil, box[2] * s, height), box)
        v.scale = s
        sides.append(v)
        x, y, w, h = box
        if x <= 2 or y <= 2 or x + w >= shape[1] - 2 or y + h >= shape[0] - 2:
            warnings.append(f"{a:g}° 사진에서 식물이 가장자리에 닿아 잘렸을 수 있어요.")
        if s > 3 or s < 1 / 3:
            warnings.append(f"{a:g}° 사진의 식물 크기가 정면 사진과 많이 달라요. 비슷한 거리에서 찍어 주세요.")

    # 마주 보는 사진(0°↔180°, 90°↔270°)은 거울상이라 폭이 비슷해야 함 → 기울어짐 확인
    for v in sides:
        opp = next((o for o in sides if abs(((o.angle - v.angle) % 360) - 180) < 1), None)
        if opp and v.angle < opp.angle:
            w1, w2 = v.sil.shape[1], opp.sil.shape[1]
            if abs(w1 - w2) / max(w1, w2) > 0.3:
                warnings.append(f"{v.angle:g}°와 {opp.angle:g}° 사진의 폭이 많이 달라요. 기울어지게 찍혔을 수 있어요.")

    def extent_for(vs):
        e = 0.0
        for v in vs:
            cols = np.nonzero(v.sil.any(axis=0))[0]
            e = max(e, abs(cols.min() - v.u - v.offset), abs(cols.max() + 1 - v.u - v.offset))
        return e * 1.1 + 2

    # 측면 2장(수직 2방향)뿐이면: 단면을 타원으로 보고 부피 추정
    if len(sides) == 2 and top_mask is None:
        a0, a1 = _row_span(sides[0].sil), _row_span(sides[1].sil)
        volume = float(np.sum(math.pi / 4 * a0 * a1))
        return _result(volume, height, sides, None, warnings, "ellipse2",
                       width=float(a0.max()), depth=float(a1.max()), top_area=float(math.pi / 4 * a0.max() * a1.max()),
                       points=_ellipse_points(a0, a1, height))

    # 회전축 위치 보정: 거친 격자에서 사진마다 차례로 (넓게 → 촘촘히) 찾기를 두 번 반복
    for _ in range(2):
        for v in sides[1:]:
            w = v.sil.shape[1]

            def score(d, v=v):
                v.offset = d
                g = _Grid(extent_for(sides), height, GRID_COARSE)
                return float(_carve_sides(sides, g, height).sum()) * g.vs ** 3

            if SEARCH <= 0:
                v.offset = 0.0
                continue
            wide = list(np.linspace(-SEARCH * w, SEARCH * w, 13))
            best, _ = _best_offset(wide, score)
            step = wide[1] - wide[0]
            v.offset, _ = _best_offset(list(np.linspace(best - step, best + step, 9)), score)

    g = _Grid(extent_for(sides), height, grid)
    occ = _carve_sides(sides, g, height)
    if not occ.any():
        raise ScanError("사진들이 서로 맞지 않아 3D 영역을 만들지 못했어요. 각도 표시와 촬영 순서를 확인해 주세요.")

    top_info = None
    if top_mask is not None:
        top_info = _apply_top(top_mask, occ, g, warnings)
        if top_info and top_info["used"]:
            occ &= _top_lookup(top_info["sil"], g, top_info["orient"], top_info["scale"], top_info["cx"], top_info["cz"])[None]

    volume = float(occ.sum()) * g.vs ** 3
    filled = occ.any(axis=0)
    xi = np.nonzero(filled.any(axis=1))[0]
    zi = np.nonzero(filled.any(axis=0))[0]
    width = float((xi.max() - xi.min() + 1) * g.vs) if len(xi) else 0.0
    depth = float((zi.max() - zi.min() + 1) * g.vs) if len(zi) else 0.0
    # 실루엣으로 만든 상자 기둥 대비 너무 작으면 정렬 실패 가능성
    bound = math.pi / 4 * width * depth * height
    if bound and volume < 0.15 * bound:
        warnings.append("3D 모양이 비정상적으로 작게 계산됐어요. 각도 순서(시계/반시계)와 촬영 높이를 확인해 주세요.")
    return _result(volume, height, sides, top_info, warnings, "hull", width=width, depth=depth,
                   top_area=float(filled.sum()) * g.vs ** 2, points=_surface_points(occ, g, height))


def _apply_top(top_mask, occ, g, warnings):
    """위 사진을 옆 사진 헐의 위에서 본 모양(발자국)과 맞춰 봄."""
    try:
        top, box = _crop(top_mask)
    except ScanError:
        warnings.append("위 사진에서 식물을 찾지 못해 빼고 계산했어요.")
        return {"used": False}
    foot = occ.any(axis=0)
    xi = np.nonzero(foot.any(axis=1))[0]
    zi = np.nonzero(foot.any(axis=0))[0]
    fw = (xi.max() - xi.min() + 1) * g.vs
    fd = (zi.max() - zi.min() + 1) * g.vs
    fx = (g.xs[xi.min()] + g.xs[xi.max()]) / 2
    fz = (g.zs[zi.min()] + g.zs[zi.max()]) / 2
    best = None
    for o in range(8):
        # 이 방향으로 놓았을 때 위 사진의 (세계 X 폭, 세계 Z 폭)
        swap = o in (1, 3, 5, 7)
        tw, td = (box[3], box[2]) if swap else (box[2], box[3])
        scale = math.sqrt((fw / tw) * (fd / td))  # 세계 px / 위 사진 px (가로·세로 비율의 기하평균)
        # 실루엣 중심이 발자국 중심에 오도록
        cx0, cz0 = top.shape[1] / 2, top.shape[0] / 2
        a, b = ORIENTS[o](np.array([fx]), np.array([fz]))
        base_cx, base_cz = cx0 - a[0] / scale, cz0 - b[0] / scale
        for dx in np.linspace(-0.06, 0.06, 5) * top.shape[1]:
            for dz in np.linspace(-0.06, 0.06, 5) * top.shape[0]:
                t = _top_lookup(top, g, o, scale, base_cx + dx, base_cz + dz)
                inter = float((t & foot).sum())
                # 실제 위 모양은 옆 사진으로 만든 발자국 안에 들어가야 함 → '포함률'로 판정
                # (격자 밖으로 삐져나간 부분까지 세도록 위 실루엣 전체 면적을 격자 칸 수로 환산)
                total = float(top.sum()) * (scale / g.vs) ** 2
                fit = min(1.0, inter / total) if total else 0.0
                iou = inter / float((t | foot).sum()) if (t | foot).any() else 0.0
                score = fit + 0.2 * iou
                if not best or score > best["score"]:
                    best = {"orient": o, "scale": scale, "cx": base_cx + dx, "cz": base_cz + dz,
                            "fit": fit, "iou": iou, "score": score}
    best["sil"] = top
    best["used"] = best["fit"] >= 0.85
    if not best["used"]:
        warnings.append("위 사진이 옆 사진들과 잘 맞지 않아 빼고 계산했어요. 정면이 사진 아래쪽에 오게, 바로 위에서 찍어 주세요.")
    elif best["fit"] < 0.93:
        warnings.append("위 사진과 옆 사진의 모양이 조금 달라요. 바로 위에서 수평으로 찍으면 더 정확해요.")
    return best


def _surface_points(occ, g, height):
    """겉면 칸만 골라 3D 미리보기용 점 [x, 높이, z] (0° 사진 픽셀 단위)"""
    pad = np.pad(occ, 1, constant_values=False)
    inner = (pad[2:, 1:-1, 1:-1] & pad[:-2, 1:-1, 1:-1] & pad[1:-1, 2:, 1:-1] & pad[1:-1, :-2, 1:-1]
             & pad[1:-1, 1:-1, 2:] & pad[1:-1, 1:-1, :-2])
    surf = np.argwhere(occ & ~inner)
    if len(surf) > MAX_POINTS:
        idx = np.random.default_rng(0).choice(len(surf), MAX_POINTS, replace=False)
        surf = surf[np.sort(idx)]
    return [[round(float(g.xs[k]), 1), round(float(height - g.ys[j]), 1), round(float(g.zs[i_]), 1)]
            for j, k, i_ in ((p[0], p[1], p[2]) for p in surf)]


def _ellipse_points(a0, a1, height):
    pts = []
    step = max(1, height // 60)
    for r in range(0, height, step):
        if a0[r] <= 0 or a1[r] <= 0:
            continue
        for t in np.linspace(0, 2 * math.pi, 24, endpoint=False):
            pts.append([round(a0[r] / 2 * math.cos(t), 1), round(float(height - r), 1), round(a1[r] / 2 * math.sin(t), 1)])
    return pts[:MAX_POINTS]


def _result(volume, height, sides, top_info, warnings, method, width, depth, top_area, points):
    return {
        "method": method,
        "volume_px": volume,
        "height_px": float(height),
        "width_px": width,
        "depth_px": depth,
        "top_area_px": top_area,
        "points": points,
        "warnings": warnings,
        "detail": {
            "views": [{"angle": v.angle, "scale": round(v.scale, 4), "axis": round(v.u, 2), "offset": round(v.offset, 2),
                       "raw_box": v.raw_box} for v in sides],
            "top": None if not top_info or "fit" not in top_info else {
                "used": top_info["used"], "orient": top_info["orient"], "fit": round(top_info["fit"], 3),
                "iou": round(top_info["iou"], 3), "scale": round(top_info["scale"], 4)},
        },
    }
