//! Театр: растр местности и дорог (около 1 км), большие реки и мосты. Читается из того же файла, что и в
//! нынешней модели (`packages/sim/data/theatres/*.json`); отдельной копии данных нет.
//!
//! Движение идёт по клеткам растра: клетка с дорогой — быстро, без дороги — по классу местности. Ход между
//! соседними клетками, пересекающий большую реку, возможен только по мосту или переправе рядом (не дальше
//! `BRIDGE_SNAP_KM`) — так колонны сходятся к мостам; без моста — только пешим порядком с задержкой
//! форсирования (правило `riverCrossHours`).

use crate::geo::{segments_cross, LngLat, Proj, XY};
use crate::time::parse_hours;
use serde::Deserialize;
use std::collections::HashMap;

pub const TERRAIN: [&str; 6] = ["open", "forest", "marsh", "urban", "hills", "water"];
pub const WATER: u8 = 5;
/// Мост относится к переходу через реку, если он не дальше этого от середины перехода, км.
pub const BRIDGE_SNAP_KM: f64 = 1.5;
/// Разрыв между кусками линии большой реки, который считается ошибкой данных и замыкается, км.
pub const RIVER_GAP_KM: f64 = 4.0;

/// Соседи клетки: восток, юго-восток, юг, юго-запад, запад, северо-запад, север, северо-восток (строки — с севера на юг).
pub const DIRS: [(i32, i32); 8] = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)];
#[inline]
pub fn opposite(d: usize) -> usize { (d + 4) % 8 }

#[derive(Deserialize)]
struct Grid {
    bbox: [f64; 4],
    cols: usize,
    rows: usize,
    rle: String,
}

#[derive(Deserialize)]
struct Line {
    #[serde(default)]
    kind: Option<String>,
    line: Vec<LngLat>,
    #[serde(default)]
    major: Option<bool>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BridgeData {
    pub id: String,
    pub at: LngLat,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub open_from: Option<String>,
    #[serde(default)]
    pub destroyed_at: Option<String>,
    #[serde(default)]
    pub side: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LineData {
    pub id: String,
    pub name: String,
    pub line: Vec<LngLat>,
    #[serde(default)]
    pub fortification: Option<u8>,
    #[serde(default)]
    pub side: Option<String>,
    #[serde(default)]
    pub depth_km: Option<f64>,
}

#[derive(Deserialize, Clone)]
pub struct AreaData {
    pub id: String,
    pub name: String,
    pub ring: Vec<LngLat>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TheatreFile {
    id: String,
    name: String,
    bbox: [f64; 4],
    terrain_grid: Grid,
    #[serde(default)]
    road_grid: Option<Grid>,
    #[serde(default)]
    roads: Vec<Line>,
    #[serde(default)]
    rivers: Vec<Line>,
    #[serde(default)]
    bridges: Vec<BridgeData>,
    #[serde(default)]
    lines: Vec<LineData>,
    #[serde(default)]
    areas: Vec<AreaData>,
}

/// Мост или переправа из данных театра: когда действует.
#[derive(Clone, Debug)]
pub struct Bridge {
    pub id: String,
    pub name: String,
    pub pos: XY,
    pub open_from: Option<i64>,
    pub destroyed_at: Option<i64>,
}

impl Bridge {
    /// Действует ли мост в момент `hour` (часы от 1970-01-01) по данным театра.
    pub fn open_at(&self, hour: i64) -> bool {
        self.open_from.map_or(true, |t| hour >= t) && self.destroyed_at.map_or(true, |t| hour < t)
    }
}

pub struct Theatre {
    pub id: String,
    pub name: String,
    pub proj: Proj,
    pub bbox: [f64; 4],
    pub cols: usize,
    pub rows: usize,
    /// Класс местности клетки (индекс в TERRAIN).
    pub terrain: Vec<u8>,
    /// Дорога в клетке: 0 — нет, 1 — дорога, 2 — шоссе.
    pub road: Vec<u8>,
    /// Биты направлений DIRS: переход в соседа пересекает большую реку.
    pub river_cross: Vec<u8>,
    /// Мост на переходе (клетка, направление) → индекс в `bridges`.
    pub crossing_bridge: HashMap<(u32, u8), u16>,
    pub bridges: Vec<Bridge>,
    pub lines: Vec<LineData>,
    pub areas: Vec<AreaData>,
    /// Центры клеток в км.
    pub centers: Vec<XY>,
    /// Укреплённая полоса в клетке: уровень (0 — нет) и чья (как в нынешней модели: клетки в пределах половины
    /// глубины полосы от её линии, не меньше одной клетки).
    pub fort: Vec<u8>,
    pub fort_side: Vec<Option<String>>,
}

fn decode_rle(rle: &str, n: usize, map: impl Fn(char) -> Option<u8>) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(n);
    let mut k = 0usize;
    for ch in rle.chars() {
        if let Some(d) = ch.to_digit(10) { k = k * 10 + d as usize; continue; }
        let v = map(ch).ok_or_else(|| format!("растр: неизвестный код «{ch}»"))?;
        out.extend(std::iter::repeat(v).take(k.max(1)));
        k = 0;
    }
    if out.len() != n { return Err(format!("растр: {} клеток вместо {n}", out.len())); }
    Ok(out)
}

pub fn decode_terrain(rle: &str, n: usize) -> Result<Vec<u8>, String> {
    decode_rle(rle, n, |c| match c { 'o' => Some(0), 'f' => Some(1), 'm' => Some(2), 'u' => Some(3), 'h' => Some(4), 'w' => Some(5), _ => None })
}

impl Theatre {
    pub fn load(path: &str) -> Result<Theatre, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
        let f: TheatreFile = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
        Theatre::build(f)
    }

    fn build(f: TheatreFile) -> Result<Theatre, String> {
        let g = &f.terrain_grid;
        let (cols, rows) = (g.cols, g.rows);
        let n = cols * rows;
        let terrain = decode_terrain(&g.rle, n)?;
        let mut road = vec![0u8; n];
        if let Some(rg) = &f.road_grid {
            if rg.cols != cols || rg.rows != rows || rg.bbox != g.bbox {
                return Err("roadGrid не совпадает с terrainGrid по сетке".into());
            }
            road = decode_rle(&rg.rle, n, |c| match c { 'n' => Some(0), 'r' => Some(1), 'h' => Some(2), _ => None })?;
        }
        let proj = Proj::new(f.bbox);
        let mut t = Theatre {
            id: f.id,
            name: f.name,
            proj,
            bbox: g.bbox,
            cols,
            rows,
            terrain,
            road,
            river_cross: vec![0u8; n],
            crossing_bridge: HashMap::new(),
            bridges: Vec::new(),
            lines: f.lines,
            areas: f.areas,
            centers: Vec::with_capacity(n),
            fort: vec![0u8; n],
            fort_side: vec![None; n],
        };
        for i in 0..n { let c = t.cell_lnglat(i); t.centers.push(proj.to_xy(c)); }
        // шоссе из линий: отмечаем клетки вдоль линии (железные дороги в движении войск не участвуют)
        for r in &f.roads {
            let k = match r.kind.as_deref() { Some("highway") => 2, Some("road") => 1, _ => continue };
            for w in r.line.windows(2) {
                let (a, b) = (proj.to_xy(w[0]), proj.to_xy(w[1]));
                let steps = (a.dist(b) / 0.3).ceil().max(1.0) as usize;
                for s in 0..=steps {
                    let p = proj.to_lnglat(XY::new(a.x + (b.x - a.x) * s as f64 / steps as f64, a.y + (b.y - a.y) * s as f64 / steps as f64));
                    if let Some(c) = t.cell_of(p) { t.road[c] = t.road[c].max(k); }
                }
            }
        }
        for b in &f.bridges {
            t.bridges.push(Bridge {
                id: b.id.clone(),
                name: b.name.clone().unwrap_or_else(|| b.id.clone()),
                pos: proj.to_xy(b.at),
                open_from: b.open_from.as_deref().and_then(parse_hours),
                destroyed_at: b.destroyed_at.as_deref().and_then(parse_hours),
            });
        }
        t.mark_rivers(&f.rivers);
        t.mark_forts();
        Ok(t)
    }

    /// Переходы между клетками, пересекающие большие реки, и мосты на них.
    fn mark_rivers(&mut self, rivers: &[Line]) {
        let mut segs: Vec<(XY, XY)> = Vec::new();
        let mut buckets: HashMap<usize, Vec<u32>> = HashMap::new();
        let major: Vec<&Line> = rivers.iter().filter(|r| r.major.unwrap_or(false) && r.line.len() >= 2).collect();
        // Линии рек в данных — куски с разрывами в несколько километров (протоки, смена названия): конец куска
        // соединяется с ближайшей точкой другого куска, иначе войска «просачиваются» через разрыв.
        let mut lines: Vec<Vec<LngLat>> = major.iter().map(|r| r.line.clone()).collect();
        for (k, r) in major.iter().enumerate() {
            let _ = &r.name;
            for end in [r.line[0], r.line[r.line.len() - 1]] {
                let e = self.proj.to_xy(end);
                let best = major.iter().enumerate().filter(|&(j, _)| j != k)
                    .flat_map(|(_, o)| o.line.iter())
                    .map(|p| (*p, self.proj.to_xy(*p).dist(e)))
                    .filter(|&(_, dk)| dk > 1e-6)
                    .min_by(|a, b| a.1.total_cmp(&b.1));
                if let Some((p, dk)) = best { if dk <= RIVER_GAP_KM { lines.push(vec![end, p]); } }
            }
        }
        for line in &lines {
            for w in line.windows(2) {
                let (a, b) = (self.proj.to_xy(w[0]), self.proj.to_xy(w[1]));
                let id = segs.len() as u32;
                segs.push((a, b));
                let (Some(ca), Some(cb)) = (self.cell_of(w[0]), self.cell_of(w[1])) else { continue };
                let (c0, r0, c1, r1) = (ca % self.cols, ca / self.cols, cb % self.cols, cb / self.cols);
                for row in r0.min(r1).saturating_sub(1)..=(r0.max(r1) + 1).min(self.rows - 1) {
                    for col in c0.min(c1).saturating_sub(1)..=(c0.max(c1) + 1).min(self.cols - 1) {
                        buckets.entry(row * self.cols + col).or_default().push(id);
                    }
                }
            }
        }
        for c in 0..self.cols * self.rows {
            let Some(list) = buckets.get(&c) else { continue };
            for d in 0..4 {
                let Some(nb) = self.neighbor(c, d) else { continue };
                let (a, b) = (self.centers[c], self.centers[nb]);
                if list.iter().any(|&s| { let (p, q) = segs[s as usize]; segments_cross(a, b, p, q) }) {
                    self.river_cross[c] |= 1 << d;
                    self.river_cross[nb] |= 1 << opposite(d);
                    let mid = XY::new((a.x + b.x) / 2.0, (a.y + b.y) / 2.0);
                    let best = self.bridges.iter().enumerate()
                        .map(|(i, br)| (i, br.pos.dist(mid)))
                        .filter(|&(_, dk)| dk <= BRIDGE_SNAP_KM)
                        .min_by(|x, y| x.1.total_cmp(&y.1));
                    if let Some((i, _)) = best {
                        self.crossing_bridge.insert((c as u32, d as u8), i as u16);
                        self.crossing_bridge.insert((nb as u32, opposite(d) as u8), i as u16);
                    }
                }
            }
        }
    }

    /// Полоса подготовленной обороны за линией `line_id` (сценарий, defenseZones): клетки своей стороны линии не дальше
    /// `depth_km` получают уровень укрепления не ниже `level`. Сторона — к западу (`west`) или к востоку от линии.
    pub fn mark_zone(&mut self, line_id: &str, depth_km: f64, level: u8, west: bool) -> usize {
        let Some(l) = self.lines.iter().find(|l| l.id == line_id).cloned() else { return 0 };
        let side = l.side.clone();
        let pts: Vec<XY> = l.line.iter().map(|p| self.proj.to_xy(*p)).collect();
        let mut n = 0;
        for c in 0..self.cols * self.rows {
            if self.fort[c] >= level { continue; }
            let p = self.centers[c];
            let mut best = (f64::INFINITY, XY::default());
            for w in pts.windows(2) {
                let (a, b) = (w[0], w[1]);
                let (vx, vy) = (b.x - a.x, b.y - a.y);
                let l2 = (vx * vx + vy * vy).max(1e-9);
                let u = (((p.x - a.x) * vx + (p.y - a.y) * vy) / l2).clamp(0.0, 1.0);
                let q = XY::new(a.x + vx * u, a.y + vy * u);
                let d = p.dist(q);
                if d < best.0 { best = (d, q); }
            }
            if best.0 > depth_km { continue; }
            if (p.x < best.1.x) != west { continue; }
            self.fort[c] = level;
            self.fort_side[c] = side.clone();
            n += 1;
        }
        n
    }

    fn mark_forts(&mut self) {
        let lines = self.lines.clone();
        for l in &lines {
            let Some(lv) = l.fortification.filter(|&v| v > 0) else { continue };
            let half = l.depth_km.unwrap_or(0.0) / 2.0;
            for w in l.line.windows(2) {
                let (a, b) = (self.proj.to_xy(w[0]), self.proj.to_xy(w[1]));
                let steps = (a.dist(b) / 0.3).ceil().max(1.0) as usize;
                for k in 0..=steps {
                    let q = XY::new(a.x + (b.x - a.x) * k as f64 / steps as f64, a.y + (b.y - a.y) * k as f64 / steps as f64);
                    let Some(c) = self.cell_of_xy(q) else { continue };
                    let r = (half.max(0.0) / 1.0).ceil() as i32 + 1;
                    let (c0, r0) = ((c % self.cols) as i32, (c / self.cols) as i32);
                    for dr in -r..=r {
                        for dc in -r..=r {
                            let (cc, rr) = (c0 + dc, r0 + dr);
                            if cc < 0 || rr < 0 || cc >= self.cols as i32 || rr >= self.rows as i32 { continue; }
                            let i = rr as usize * self.cols + cc as usize;
                            let near = self.centers[i].dist(q) <= half.max(0.5);
                            if near && lv >= self.fort[i] { self.fort[i] = lv; self.fort_side[i] = l.side.clone(); }
                        }
                    }
                }
            }
        }
    }

    pub fn cell_lnglat(&self, i: usize) -> LngLat {
        let (col, row) = (i % self.cols, i / self.cols);
        let [w, s, e, n] = self.bbox;
        [w + (col as f64 + 0.5) * (e - w) / self.cols as f64, n - (row as f64 + 0.5) * (n - s) / self.rows as f64]
    }

    pub fn cell_of(&self, p: LngLat) -> Option<usize> {
        let [w, s, e, n] = self.bbox;
        if p[0] < w || p[0] >= e || p[1] <= s || p[1] > n { return None; }
        let col = ((p[0] - w) / (e - w) * self.cols as f64) as usize;
        let row = ((n - p[1]) / (n - s) * self.rows as f64) as usize;
        Some(row.min(self.rows - 1) * self.cols + col.min(self.cols - 1))
    }

    pub fn cell_of_xy(&self, q: XY) -> Option<usize> { self.cell_of(self.proj.to_lnglat(q)) }

    #[inline]
    pub fn neighbor(&self, c: usize, d: usize) -> Option<usize> {
        let (col, row) = ((c % self.cols) as i32 + DIRS[d].0, (c / self.cols) as i32 + DIRS[d].1);
        if col < 0 || row < 0 || col >= self.cols as i32 || row >= self.rows as i32 { None } else { Some(row as usize * self.cols + col as usize) }
    }

    /// Ближайшая к точке клетка суши (войска не стоят в воде).
    pub fn land_cell_near(&self, q: XY) -> Option<usize> {
        let c = self.cell_of_xy(q)?;
        if self.terrain[c] != WATER { return Some(c); }
        let (col, row) = ((c % self.cols) as i32, (c / self.cols) as i32);
        for r in 1..6i32 {
            let mut best: Option<(usize, f64)> = None;
            for dr in -r..=r {
                for dc in -r..=r {
                    if dr.abs() != r && dc.abs() != r { continue; }
                    let (cc, rr) = (col + dc, row + dr);
                    if cc < 0 || rr < 0 || cc >= self.cols as i32 || rr >= self.rows as i32 { continue; }
                    let k = rr as usize * self.cols + cc as usize;
                    if self.terrain[k] == WATER { continue; }
                    let d = self.centers[k].dist(q);
                    if best.map_or(true, |(_, bd)| d < bd) { best = Some((k, d)); }
                }
            }
            if let Some((k, _)) = best { return Some(k); }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rle() {
        assert_eq!(decode_terrain("2o3fw", 6).unwrap(), vec![0, 0, 1, 1, 1, 5]);
        assert!(decode_terrain("2o", 3).is_err());
    }
}
