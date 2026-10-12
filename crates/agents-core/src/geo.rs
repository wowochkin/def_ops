//! Координаты: долгота и широта ↔ километры на плоскости театра. Масштаб по долготе берётся по широте точки,
//! поэтому расстояния верны локально по всему театру (ошибка не накапливается к краям, как у одной средней широты).

pub type LngLat = [f64; 2];

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct XY {
    pub x: f64,
    pub y: f64,
}

impl XY {
    pub fn new(x: f64, y: f64) -> Self { XY { x, y } }
    #[inline]
    pub fn dist(self, o: XY) -> f64 { ((self.x - o.x).powi(2) + (self.y - o.y).powi(2)).sqrt() }
    #[inline]
    pub fn toward(self, o: XY, km: f64) -> XY {
        let d = self.dist(o);
        if d <= km || d == 0.0 { return o; }
        XY::new(self.x + (o.x - self.x) * km / d, self.y + (o.y - self.y) * km / d)
    }
}

const KM_LAT: f64 = 110.574;
const KM_LNG_EQ: f64 = 111.320;

#[derive(Clone, Copy, Debug)]
pub struct Proj {
    pub lng0: f64,
    pub lat0: f64,
}

impl Proj {
    pub fn new(bbox: [f64; 4]) -> Self { Proj { lng0: (bbox[0] + bbox[2]) / 2.0, lat0: (bbox[1] + bbox[3]) / 2.0 } }
    pub fn to_xy(&self, p: LngLat) -> XY {
        XY::new((p[0] - self.lng0) * KM_LNG_EQ * p[1].to_radians().cos(), (p[1] - self.lat0) * KM_LAT)
    }
    pub fn to_lnglat(&self, q: XY) -> LngLat {
        let lat = q.y / KM_LAT + self.lat0;
        [q.x / (KM_LNG_EQ * lat.to_radians().cos()) + self.lng0, lat]
    }
}

/// Пересекаются ли отрезки ab и cd (касание считается пересечением).
pub fn segments_cross(a: XY, b: XY, c: XY, d: XY) -> bool {
    fn orient(p: XY, q: XY, r: XY) -> f64 { (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) }
    let (d1, d2) = (orient(c, d, a), orient(c, d, b));
    let (d3, d4) = (orient(a, b, c), orient(a, b, d));
    (d1 * d2 <= 0.0) && (d3 * d4 <= 0.0) && !(d1 == 0.0 && d2 == 0.0 && d3 == 0.0 && d4 == 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_and_scale() {
        let p = Proj::new([11.0, 50.9, 15.6, 54.45]);
        let a = [13.4, 52.52];
        let b = p.to_lnglat(p.to_xy(a));
        assert!((a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9);
        // Берлин — Франкфурт-на-Одере ≈ 81 км
        let d = p.to_xy([13.405, 52.52]).dist(p.to_xy([14.55, 52.347]));
        assert!((d - 81.0).abs() < 3.0, "{d}");
    }
}
