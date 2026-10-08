#!/usr/bin/env python3
"""
Сборщик театра для @def-ops/sim из открытых данных по «рецепту».

Рецепт (data/theatres/src/<id>.recipe.json) задаёт охват, шаг сетки, правила
классификации местности, какие реки большие, какие дороги — шоссе, а также
исторический слой: рубежи, переправы, разрушенные мосты, районы. Сборщик
скачивает исходные данные в кэш, сводит их на сетку и пишет
data/theatres/<id>.json (формат TheatreData).

Источники (скачиваются один раз в кэш, по умолчанию ~/.cache/def-ops-theatre):
  - ESA WorldCover 10 m 2021 — земной покров (лес, застройка, вода, болото);
  - Copernicus DEM GLO-90 — рельеф (перепад высот → «высоты»);
  - OpenStreetMap через Overpass API — реки, каналы, дороги, железные дороги.

Запуск:
  python3 -m venv .venv && .venv/bin/pip install -r tools/theatre/requirements.txt
  .venv/bin/python tools/theatre/build_theatre.py data/theatres/src/oder-berlin-1945.recipe.json

Свои файлы вместо скачивания: --worldcover DIR --dem DIR --osm DIR
(имена как в кэше: ESA_WorldCover_..._N51E012_Map.tif, Copernicus_DSM_COG_30_N52_00_E014_00_DEM.tif,
water.json, roads.json, rail.json).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

CODES = {"open": "o", "forest": "f", "marsh": "m", "urban": "u", "hills": "h", "water": "w"}
UA = "def-ops-theatre/1.0"
OVERPASS = os.environ.get("OVERPASS_URL", "https://maps.mail.ru/osm/tools/overpass/api/interpreter")
WC_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
DEM_URL = "https://copernicus-dem-90m.s3.amazonaws.com/{n}/{n}.tif"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url: str, dest: Path, data: bytes | None = None, tries: int = 3) -> Path:
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    for k in range(tries):
        try:
            log(f"  загрузка {url[:100]}")
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=900) as r, open(dest.with_suffix(".part"), "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            dest.with_suffix(".part").rename(dest)
            if dest.stat().st_size > 1000:
                return dest
        except Exception as e:  # noqa: BLE001
            log(f"  ошибка: {e}; повтор через {10 * (k + 1)} с")
        time.sleep(10 * (k + 1))
    raise RuntimeError(f"не удалось загрузить {url}")


# ------------------------------------------------------------------ местность

def wc_tiles(bbox):
    w, s, e, n = bbox
    out = []
    for la in range(int(math.floor(s / 3) * 3), int(math.ceil(n / 3) * 3), 3):
        for lo in range(int(math.floor(w / 3) * 3), int(math.ceil(e / 3) * 3), 3):
            out.append(f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}")
    return out


def dem_tiles(bbox):
    w, s, e, n = bbox
    return [f"Copernicus_DSM_COG_30_N{la:02d}_00_E{lo:03d}_00_DEM"
            for la in range(int(math.floor(s)), int(math.ceil(n)))
            for lo in range(int(math.floor(w)), int(math.ceil(e)))]


def read_mosaic(paths, bbox, px_deg, resampling, dtype):
    """Свести тайлы в одну сетку bbox с шагом px_deg (градусы)."""
    w, s, e, n = bbox
    W, H = int(round((e - w) / px_deg)), int(round((n - s) / px_deg))
    out = np.zeros((H, W), dtype=dtype)
    for p in paths:
        with rasterio.open(p) as r:
            b = r.bounds
            iw, is_, ie, in_ = max(w, b.left), max(s, b.bottom), min(e, b.right), min(n, b.top)
            if iw >= ie or is_ >= in_:
                continue
            c0, c1 = int(round((iw - w) / px_deg)), int(round((ie - w) / px_deg))
            r0, r1 = int(round((n - in_) / px_deg)), int(round((n - is_) / px_deg))
            if c1 <= c0 or r1 <= r0:
                continue
            win = from_bounds(iw, is_, ie, in_, r.transform)
            out[r0:r1, c0:c1] = r.read(1, window=win, out_shape=(r1 - r0, c1 - c0), resampling=resampling)
    return out


def classify(recipe, wc_paths, dem_paths):
    w, s, e, n = recipe["bbox"]
    dl, da = recipe["grid"]["dLng"], recipe["grid"]["dLat"]
    cols, rows = int(round((e - w) / dl)), int(round((n - s) / da))
    rules = recipe["landcover"]["rules"]
    # земной покров ~0.0015° (≈100–150 м): ближайший сосед с обзорного уровня, затем доли по клеткам
    px = 0.0015
    lc = read_mosaic(wc_paths, (w, s, e, n), px, Resampling.nearest, np.uint8)
    H, W = lc.shape
    ri = np.minimum((np.arange(H) * px / da).astype(int), rows - 1)
    ci = np.minimum((np.arange(W) * px / dl).astype(int), cols - 1)
    cell = (ri[:, None] * cols + ci[None, :]).ravel()
    total = np.bincount(cell, minlength=rows * cols).astype(float)
    total[total == 0] = 1

    def frac(codes):
        m = np.isin(lc.ravel(), codes)
        return np.bincount(cell[m], minlength=rows * cols) / total

    water, urban, marsh, forest = frac([80]), frac([50]), frac([90, 95]), frac([10])
    nodata = frac([0])

    # рельеф: перепад высот и средний уклон в клетке
    dpx = 1 / 1200  # 3″
    dem = read_mosaic(dem_paths, (w, s, e, n), dpx, Resampling.bilinear, np.float32)
    dH, dW = dem.shape
    lat_mid = (s + n) / 2
    # DEM — модель поверхности (с лесом и зданиями): сглаживаем окном ~450 м, чтобы опушки не давали «высот»
    dem = box_blur(dem, recipe["relief"].get("smoothPx", 5))
    gy, gx = np.gradient(dem, dpx * 110570, dpx * 111320 * math.cos(math.radians(lat_mid)))
    slope = np.hypot(gx, gy)
    ri = np.minimum((np.arange(dH) * dpx / da).astype(int), rows - 1)
    ci = np.minimum((np.arange(dW) * dpx / dl).astype(int), cols - 1)
    dcell = (ri[:, None] * cols + ci[None, :]).ravel()
    dcount = np.bincount(dcell, minlength=rows * cols).astype(float)
    dcount[dcount == 0] = 1
    mean_slope = np.bincount(dcell, weights=slope.ravel(), minlength=rows * cols) / dcount
    zmax = np.full(rows * cols, -1e9)
    zmin = np.full(rows * cols, 1e9)
    np.maximum.at(zmax, dcell, dem.ravel())
    np.minimum.at(zmin, dcell, dem.ravel())
    # перепад — по окну 3×3 клетки: уступ вроде Зееловских высот (≈45 м на 1,5 км) ложится на границу клеток
    zmax2, zmin2 = zmax.reshape(rows, cols), zmin.reshape(rows, cols)
    pmax, pmin = np.pad(zmax2, 1, mode="edge"), np.pad(zmin2, 1, mode="edge")
    nmax = np.max([pmax[1 + dy:rows + 1 + dy, 1 + dx:cols + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)], axis=0)
    nmin = np.min([pmin[1 + dy:rows + 1 + dy, 1 + dx:cols + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)], axis=0)
    relief = (nmax - nmin).ravel()
    rel = recipe["relief"]
    hills = (relief >= rel["hillsReliefM"]) & (mean_slope >= rel["hillsSlope"])

    k = np.full(rows * cols, 0, dtype=np.uint8)  # open
    order = ["open", "forest", "marsh", "urban", "hills", "water"]
    k[hills] = order.index("hills")
    k[forest >= rules["forest"]] = order.index("forest")
    k[marsh >= rules["marsh"]] = order.index("marsh")
    k[urban >= rules["urban"]] = order.index("urban")
    k[(water >= rules["water"]) | (nodata >= 0.5)] = order.index("water")  # вне покрытия — море
    stats = {c: int((k == i).sum()) for i, c in enumerate(order)}
    return k, cols, rows, stats


def box_blur(a, r):
    """Скользящее среднее окном (2r+1)² через интегральное изображение."""
    if r <= 0:
        return a
    p = np.pad(a.astype(np.float64), r + 1, mode="edge")
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k))[: a.shape[0], : a.shape[1]].astype(np.float32)


def merge_lines(items, key):
    """Склеить линии с общими концами (одинаковый key) — меньше объектов в файле."""
    from collections import defaultdict
    ends = defaultdict(list)
    for i, it in enumerate(items):
        ends[(key(it), it[1][0])].append(i)
        ends[(key(it), it[1][-1])].append(i)
    used = [False] * len(items)
    out = []
    for i, it in enumerate(items):
        if used[i]:
            continue
        used[i] = True
        line = list(it[1])
        for side in (1, 0):
            while True:
                tip = line[-1] if side else line[0]
                nxt = next((j for j in ends[(key(it), tip)] if not used[j]), None)
                if nxt is None:
                    break
                used[nxt] = True
                seg = items[nxt][1]
                if seg[0] != tip:
                    seg = seg[::-1]  # теперь seg начинается в tip
                line = line + seg[1:] if side else list(reversed(seg))[:-1] + line
        out.append((it[0], line))
    return out


def rle(k):
    letters = [CODES[c] for c in ["open", "forest", "marsh", "urban", "hills", "water"]]
    out, i, N = [], 0, len(k)
    while i < N:
        j = i
        while j < N and k[j] == k[i]:
            j += 1
        out.append(f"{j - i if j - i > 1 else ''}{letters[k[i]]}")
        i = j
    return "".join(out)


# ------------------------------------------------------------------ линии

def simplify(pts, tol):
    """Дуглас — Пекер в градусах."""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    L = np.hypot(*ab)
    P = np.array(pts[1:-1])
    D = P - a
    d = np.abs(ab[0] * D[:, 1] - ab[1] * D[:, 0]) / L if L > 0 else np.hypot(D[:, 0], D[:, 1])
    i = int(np.argmax(d))
    if d[i] > tol:
        return simplify(pts[: i + 2], tol)[:-1] + simplify(pts[i + 1:], tol)
    return [pts[0], pts[-1]]


def rnd(p):
    return [round(p[0], 4), round(p[1], 4)]


def osm_ways(path):
    d = json.load(open(path))
    for el in d["elements"]:
        if el.get("type") == "way" and el.get("geometry"):
            yield el.get("tags", {}), [(g["lon"], g["lat"]) for g in el["geometry"]]


def river_name(tags, names):
    nm = tags.get("name") or ""
    for part in [nm] + [x.strip() for x in nm.replace(";", "/").split("/")]:
        if part in names:
            return part
    return None


def overpass(query, dest):
    return fetch(OVERPASS, dest, data=urllib.parse.urlencode({"data": query}).encode())


# ------------------------------------------------------------------ геометрия

def km_proj(lat0):
    kx, ky = 111.32 * math.cos(math.radians(lat0)), 110.57
    return kx, ky


def seg_intersect(p1, p2, q1, q2):
    d = (p2[0] - p1[0]) * (q2[1] - q1[1]) - (p2[1] - p1[1]) * (q2[0] - q1[0])
    if d == 0:
        return None
    t = ((q1[0] - p1[0]) * (q2[1] - q1[1]) - (q1[1] - p1[1]) * (q2[0] - q1[0])) / d
    u = ((q1[0] - p1[0]) * (p2[1] - p1[1]) - (q1[1] - p1[1]) * (p2[0] - p1[0])) / d
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1]))
    return None


def circle(c, r_km, n=16):
    kx, ky = km_proj(c[1])
    return [rnd((c[0] + r_km / kx * math.cos(2 * math.pi * i / n), c[1] + r_km / ky * math.sin(2 * math.pi * i / n))) for i in range(n)]


def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


# ------------------------------------------------------------------ исторические поправки

def decode_mask(r, n):
    out = np.zeros(n, dtype=np.uint8)
    i = 0
    for part in r.split(","):
        cnt = int(part[:-1]) if len(part) > 1 else 1
        out[i:i + cnt] = int(part[-1])
        i += cnt
    if i != n:
        raise ValueError(f"маска: {i} клеток вместо {n}")
    return out


def apply_overlays(recipe, rp, k, cols, rows, bbox, roads):
    """
    Поправки по историческим картам (результат raster_overlay.ts): застройка,
    леса, вода — поверх современного покрова; современная застройка, которой на
    исторической карте нет, понижается до открытой местности; дороги исторической
    карты — растром roadGrid, современные основные дороги в охвате карты убираются.
    Нет файла — поправка пропускается (театр собирается и без неё).
    """
    order = ["open", "forest", "marsh", "urban", "hills", "water"]
    w, s, e, n = bbox
    dl, da = (e - w) / cols, (n - s) / rows
    road = np.zeros(cols * rows, dtype=np.uint8)
    notes = []
    any_road = False
    for ov in recipe.get("overlays", []):
        f = (rp.parent / ov["file"]).resolve()
        if not f.exists():
            log(f"  поправка {ov['file']}: файла нет — пропуск")
            continue
        o = json.load(open(f))
        oc, orr = o["cols"], o["rows"]
        ow, os_, oe, on = o["bbox"]
        cov = decode_mask(o["covered"], oc * orr)
        masks = {name: decode_mask(m, oc * orr) for name, m in o["masks"].items()}
        changed = {}
        # центр каждой клетки театра → клетка поправки
        for r in range(rows):
            lat = n - (r + 0.5) * da
            gr = int((on - lat) / (on - os_) * orr)
            if gr < 0 or gr >= orr:
                continue
            for c in range(cols):
                lng = w + (c + 0.5) * dl
                gc = int((lng - ow) / (oe - ow) * oc)
                if gc < 0 or gc >= oc:
                    continue
                j = gr * oc + gc
                if not cov[j]:
                    continue
                clip = ov.get("clip")
                if clip and not (clip[0] <= lng <= clip[2] and clip[1] <= lat <= clip[3]):
                    continue
                i = r * cols + c
                before = k[i]
                promoted = False
                for mname, cls in (ov.get("promote") or {}).items():
                    if masks.get(mname) is not None and masks[mname][j] and k[i] != order.index("water"):
                        k[i] = order.index(cls)
                        promoted = True
                        break
                for cls in (() if promoted else ("water", "urban", "forest")):
                    src = ov.get(cls)
                    if src and masks.get(src) is not None and masks[src][j]:
                        k[i] = order.index(cls)
                        break
                else:
                    demote = None if promoted else ov.get("demoteModernUrban")
                    keep = ov.get("keepUrban")
                    kept = keep and masks.get(keep) is not None and masks[keep][j]
                    if demote and k[i] == order.index("urban") and not kept:
                        k[i] = order.index(demote)
                if ov.get("road") and masks.get(ov["road"]) is not None and masks[ov["road"]][j]:
                    road[i] = 1
                    any_road = True
                if k[i] != before:
                    key = f"{order[before]}→{order[k[i]]}"
                    changed[key] = changed.get(key, 0) + 1
        if ov.get("replaceModernRoads"):
            def inside(line):
                mx = sum(p[0] for p in line) / len(line)
                my = sum(p[1] for p in line) / len(line)
                gc = int((mx - ow) / (oe - ow) * oc)
                gr = int((on - my) / (on - os_) * orr)
                return 0 <= gc < oc and 0 <= gr < orr and cov[gr * oc + gc]
            before = len(roads)
            roads[:] = [rd for rd in roads if rd["kind"] != "road" or not inside(rd["line"])]
            changed["современных дорог убрано"] = before - len(roads)
        log(f"  поправка {o['legend']}: {changed}")
        notes.append(f"Историческая поправка: {o['name']} (уровень {o['zoom']}, правила распознавания — tools/theatre/legends/{o['legend']}.json); изменения: {changed}")
    if not any_road:
        return None, notes
    letters = "".join("r" if x else "n" for x in road)
    out, i = [], 0
    while i < len(letters):
        j = i
        while j < len(letters) and letters[j] == letters[i]:
            j += 1
        out.append(f"{j - i if j - i > 1 else ''}{letters[i]}")
        i = j
    return {"bbox": bbox, "cols": cols, "rows": rows, "rle": "".join(out), "source": "дороги исторических карт (raster_overlay)"}, notes


# ------------------------------------------------------------------ сборка

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("recipe")
    ap.add_argument("--out")
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/def-ops-theatre"))
    ap.add_argument("--worldcover")
    ap.add_argument("--dem")
    ap.add_argument("--osm")
    a = ap.parse_args()

    rp = Path(a.recipe).resolve()
    recipe = json.load(open(rp))
    cache = Path(a.cache)
    bbox = recipe["bbox"]
    w, s, e, n = bbox
    out = Path(a.out) if a.out else rp.parent.parent / f"{recipe['id']}.json"

    # справочник мест
    gaz = {}
    for g in recipe.get("gazetteers", []):
        d = json.load(open((rp.parent / g).resolve()))
        for k, v in (d.get("gazetteer") or {}).items():
            gaz[k] = (v["lng"], v["lat"])

    def place(p):
        if isinstance(p, list):
            return tuple(p)
        if p not in gaz:
            raise SystemExit(f"нет места «{p}» в справочнике")
        return gaz[p]

    # 1. местность
    log("местность: земной покров и рельеф")
    wc_dir = Path(a.worldcover) if a.worldcover else cache / "worldcover"
    dem_dir = Path(a.dem) if a.dem else cache / "dem"
    wc_paths = [fetch(WC_URL.format(t=t), wc_dir / f"ESA_WorldCover_10m_2021_v200_{t}_Map.tif") for t in wc_tiles(bbox)]
    dem_paths = []
    for t in dem_tiles(bbox):
        try:
            dem_paths.append(fetch(DEM_URL.format(n=t), dem_dir / f"{t}.tif"))
        except RuntimeError:
            log(f"  нет тайла рельефа {t} (море?) — пропуск")
    k, cols, rows, stats = classify(recipe, wc_paths, dem_paths)
    log(f"  сетка {cols}×{rows}: {stats}")

    # 2. реки
    log("реки и каналы")
    osm_dir = Path(a.osm) if a.osm else cache / "osm" / recipe["id"]
    bb = f"{s},{w},{n},{e}"
    water = overpass(f'[out:json][timeout:600];(way["waterway"~"^(river|canal)$"]({bb}););out tags geom;', osm_dir / "water.json")
    major, minor = set(recipe["rivers"]["major"]), set(recipe["rivers"]["minor"])
    rivers = []
    tol = recipe["roads"]["simplifyDeg"]
    major_segs = []
    for tags, pts in osm_ways(water):
        nm = river_name(tags, major | minor)
        if not nm:
            continue
        is_major = nm in major
        line = [rnd(p) for p in simplify(pts, tol / 2)]
        rivers.append({"name": tags.get("name"), "line": line, "major": bool(is_major), "group": nm})
        if is_major:
            major_segs.append((nm, pts))
    log(f"  {len(rivers)} участков, больших {sum(r['major'] for r in rivers)}")

    # 3. дороги
    log("дороги")
    hw_re = "|".join(["motorway"] + recipe["roads"]["roadHighways"])
    roads_p = overpass(f'[out:json][timeout:600];(way["highway"~"^({hw_re})$"]({bb}););out tags geom;', osm_dir / "roads.json")
    rail_p = overpass(f'[out:json][timeout:600];(way["railway"="rail"]["usage"="main"]({bb}););out tags geom;', osm_dir / "rail.json")
    rab = set(recipe["roads"]["highwayRefs"])
    road_kinds = set(recipe["roads"]["roadHighways"])
    roads, crossers, raw_roads, raw_rail = [], [], [], []
    for tags, pts in osm_ways(roads_p):
        hw = tags.get("highway")
        if hw == "motorway":
            if tags.get("ref") not in rab:
                continue
            kind = "highway"
        elif hw in road_kinds:
            kind = "road"
        else:
            continue
        crossers.append((kind, tags.get("ref") or tags.get("name") or "", pts))
        raw_roads.append(((kind, tags.get("ref") or ""), pts))
    for (kind, ref), pts in merge_lines(raw_roads, lambda it: it[0]):
        roads.append({"kind": kind, "line": [rnd(p) for p in simplify(pts, tol)], **({"name": ref} if ref else {})})
    nroad = len(roads)
    for tags, pts in osm_ways(rail_p):
        raw_rail.append(("rail", pts))
        crossers.append(("rail", tags.get("name") or "ж.-д.", pts))
    for _, pts in merge_lines(raw_rail, lambda it: it[0]):
        roads.append({"kind": "rail", "line": [rnd(p) for p in simplify(pts, recipe["rail"]["simplifyDeg"])]})
    log(f"  дорог {nroad}, ж.-д. {len(roads) - nroad}")

    # 4. мосты: пересечения с большими реками
    log("мосты")
    kx, ky = km_proj((s + n) / 2)
    cell = 0.05
    grid = {}
    for ri, (nm, pts) in enumerate(major_segs):
        for j in range(1, len(pts)):
            a1, b1 = pts[j - 1], pts[j]
            for gx in range(int(min(a1[0], b1[0]) / cell), int(max(a1[0], b1[0]) / cell) + 1):
                for gy in range(int(min(a1[1], b1[1]) / cell), int(max(a1[1], b1[1]) / cell) + 1):
                    grid.setdefault((gx, gy), []).append((nm, a1, b1))
    found = []
    for kind, ref, pts in crossers:
        for j in range(1, len(pts)):
            p1, p2 = pts[j - 1], pts[j]
            cand = set()
            for gx in range(int(min(p1[0], p2[0]) / cell), int(max(p1[0], p2[0]) / cell) + 1):
                for gy in range(int(min(p1[1], p2[1]) / cell), int(max(p1[1], p2[1]) / cell) + 1):
                    cand.update((nm, a1, b1) for nm, a1, b1 in grid.get((gx, gy), []))
            for nm, a1, b1 in cand:
                x = seg_intersect(p1, p2, a1, b1)
                if x:
                    found.append((x, nm, kind, ref))
    dd = recipe["bridges"]["dedupeKm"]
    bridges = []
    for x, nm, kind, ref in found:
        if any(math.hypot((x[0] - b["at"][0]) * kx, (x[1] - b["at"][1]) * ky) < dd for b in bridges):
            continue
        bridges.append({"id": f"br{len(bridges) + 1}", "at": rnd(x), "name": f"{nm}: {ref}".strip(": "), "river": nm, "kind": kind})
    for b in bridges:
        for rule in recipe["bridges"]["rules"]:
            if b["river"] not in rule.get("rivers", [b["river"]]):
                continue
            if "near" in rule:
                c = place(rule["near"])
                if math.hypot((b["at"][0] - c[0]) * kx, (b["at"][1] - c[1]) * ky) > rule["km"]:
                    continue
            b["destroyedAt"] = rule["destroyedAt"]
            b["note"] = rule.get("note")
    for c in recipe["bridges"]["crossings"]:
        bridges.append({"id": c["id"], "at": rnd(place(c["at"])), "name": c["name"], "openFrom": c["openFrom"], "kind": "crossing", "note": c.get("note")})
    log(f"  мостов {len(bridges)}, разрушенных к 16.04: {sum(1 for b in bridges if b.get('destroyedAt', '9') < '1945-04-16')}")

    # 5. рубежи и районы
    lines = [{"id": l["id"], "name": l["name"], "side": l.get("side"), "fortification": l.get("fortification"), "depthKm": l.get("depthKm"),
              "line": [rnd(place(p)) for p in l["places"]], "note": l.get("note")} for l in recipe["lines"]]
    areas = []
    for x in recipe["areas"]["explicit"]:
        ring = circle(place(x["place"]), x["radiusKm"]) if "place" in x else [rnd(p) for p in hull([place(p) for p in x["places"]])]
        areas.append({"id": x["id"], "name": x["name"], "ring": ring})
    fg = recipe["areas"].get("fromGazetteer")
    if fg:
        explicit = list(areas)
        areas = []
        for key, c in sorted(gaz.items()):
            if not (w <= c[0] <= e and s <= c[1] <= n):
                continue
            r = fg["berlinRadiusKm"] if key.startswith(fg["berlinPrefix"]) else fg["radiusKm"]
            areas.append({"id": key, "name": key, "ring": circle(c, r, 12)})
        areas += explicit  # большие районы — после точечных: areaAt найдёт сначала пункт

    # 6. исторические поправки по растровым картам (tools/theatre/raster_overlay.ts)
    road_grid, overlay_notes = apply_overlays(recipe, rp, k, cols, rows, bbox, roads)
    stats = {c: int((k == i).sum()) for i, c in enumerate(["open", "forest", "marsh", "urban", "hills", "water"])}

    theatre = {
        "id": recipe["id"], "name": recipe["name"], "bbox": bbox, "cellKm": recipe["cellKm"],
        "defaultTerrain": recipe["defaultTerrain"],
        "terrainGrid": {"bbox": bbox, "cols": cols, "rows": rows, "rle": rle(k),
                        "source": "ESA WorldCover 2021 + Copernicus DEM GLO-90; доли классов по клетке, правила — в рецепте"},
        "terrain": [], "roads": roads, "rivers": [{k2: v for k2, v in r.items() if k2 != "group"} for r in rivers],
        "bridges": [{k2: v for k2, v in b.items() if v is not None} for b in bridges],
        "areas": areas, "lines": [{k2: v for k2, v in l.items() if v is not None} for l in lines],
        **({"roadGrid": road_grid} if road_grid else {}),
        "sources": recipe["sources"] + overlay_notes, "caveats": recipe.get("caveats", []),
        "build": {"recipe": rp.name, "stats": stats},
    }
    out.write_text(json.dumps(theatre, ensure_ascii=False, separators=(",", ":")))
    log(f"готово: {out} ({out.stat().st_size / 1e6:.1f} МБ)")


if __name__ == "__main__":
    main()
