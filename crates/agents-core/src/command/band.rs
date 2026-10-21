//! Полоса штаба (раздел 1 спецификации): левая и правая разграничительные линии по оси наступления; деление полосы
//! между подчинёнными по весам (на главном направлении — уже) и часть рубежа задачи внутри полосы.

use crate::geo::XY;

/// Полоса: левая и правая границы по направлению оси (от исходного положения к цели).
#[derive(Clone, Debug, PartialEq)]
pub struct Band { pub left: Vec<XY>, pub right: Vec<XY> }

/// Точек на границе при делении полосы.
const SAMPLES: usize = 16;

fn sub(a: XY, b: XY) -> XY { XY::new(a.x - b.x, a.y - b.y) }
fn add(a: XY, b: XY) -> XY { XY::new(a.x + b.x, a.y + b.y) }
fn mul(a: XY, k: f64) -> XY { XY::new(a.x * k, a.y * k) }
fn lerp(a: XY, b: XY, t: f64) -> XY { add(a, mul(sub(b, a), t)) }
fn cross(a: XY, b: XY) -> f64 { a.x * b.y - a.y * b.x }
fn dot(a: XY, b: XY) -> f64 { a.x * b.x + a.y * b.y }
fn mean(ps: &[XY]) -> XY { let n = ps.len().max(1) as f64; XY::new(ps.iter().map(|p| p.x).sum::<f64>() / n, ps.iter().map(|p| p.y).sum::<f64>() / n) }

/// Полоса штаба: границы — разграничительные линии слева и справа от оси (по знаку векторного произведения; из
/// нескольких на одной стороне — ближайшая к оси); недостающая граница — параллельно оси на расстоянии крайнего
/// подчинённого + 2 км, но не ближе половины `min_width_km`. Оси нет — от центра подчинённых на запад.
pub fn band_of(axis: &[XY], boundaries: &[(Option<u32>, Vec<XY>)], subs_pos: &[XY], min_width_km: f64) -> Band {
    let base = if axis.is_empty() { mean(subs_pos) } else { axis[0] };
    let (dir, len) = match axis {
        [a, .., b] if a.dist(*b) > 1e-6 => (mul(sub(*b, *a), 1.0 / a.dist(*b)), a.dist(*b)),
        _ => (XY::new(-1.0, 0.0), 30.0),
    };
    let n = XY::new(-dir.y, dir.x); // влево от направления
    let side = |l: &Vec<XY>| cross(dir, sub(mean(l), base));
    let near = |left: bool| boundaries.iter().map(|(_, l)| l).filter(|l| l.len() >= 2 && (side(l) > 0.0) == left)
        .min_by(|a, b| side(a).abs().total_cmp(&side(b).abs())).cloned();
    let reach = |s: f64| subs_pos.iter().map(|p| s * dot(sub(*p, base), n)).fold(0.0, f64::max);
    let parallel = |s: f64| {
        let off = (reach(s) + 2.0).max(min_width_km / 2.0);
        let a = add(base, mul(n, s * off));
        vec![a, add(a, mul(dir, len))]
    };
    Band { left: near(true).unwrap_or_else(|| parallel(1.0)), right: near(false).unwrap_or_else(|| parallel(-1.0)) }
}

/// Точки ломаной, равномерно по длине (`k` точек).
fn sample(line: &[XY], k: usize) -> Vec<XY> {
    if line.len() < 2 { return vec![line.first().copied().unwrap_or_default(); k]; }
    let segs: Vec<f64> = line.windows(2).map(|w| w[0].dist(w[1])).collect();
    let total: f64 = segs.iter().sum::<f64>().max(1e-9);
    (0..k).map(|i| {
        let mut s = total * i as f64 / (k - 1) as f64;
        for (j, &l) in segs.iter().enumerate() {
            if s <= l || j == segs.len() - 1 { return lerp(line[j], line[j + 1], if l > 1e-9 { (s / l).min(1.0) } else { 0.0 }); }
            s -= l;
        }
        *line.last().unwrap()
    }).collect()
}

/// Деление полосы поперёк между подчинёнными по весам (слева направо).
pub fn split(band: &Band, weights: &[f64]) -> Vec<Band> {
    let (l, r) = (sample(&band.left, SAMPLES), sample(&band.right, SAMPLES));
    let total: f64 = weights.iter().sum::<f64>().max(1e-9);
    let mut acc = 0.0;
    weights.iter().map(|w| {
        let (a, b) = (acc / total, (acc + w) / total);
        acc += w;
        Band { left: (0..SAMPLES).map(|i| lerp(l[i], r[i], a)).collect(), right: (0..SAMPLES).map(|i| lerp(l[i], r[i], b)).collect() }
    }).collect()
}

/// Ось полосы: середины между границами.
pub fn center(band: &Band) -> Vec<XY> {
    let (l, r) = (sample(&band.left, SAMPLES), sample(&band.right, SAMPLES));
    (0..SAMPLES).map(|i| lerp(l[i], r[i], 0.5)).collect()
}

fn inside(p: XY, poly: &[XY]) -> bool {
    let mut c = false;
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y) { c = !c; }
    }
    c
}

fn intersect(a: XY, b: XY, c: XY, d: XY) -> Option<XY> {
    let (r, s) = (sub(b, a), sub(d, c));
    let den = cross(r, s);
    if den.abs() < 1e-12 { return None; }
    let t = cross(sub(c, a), s) / den;
    let u = cross(sub(c, a), r) / den;
    ((0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u)).then(|| add(a, mul(r, t)))
}

/// Часть рубежа внутри полосы. Рубеж из одной точки — она; рубеж не заходит в полосу — точка пересечения оси полосы
/// с рубежом, иначе центр рубежа.
pub fn clip_line(line: &[XY], band: &Band) -> Vec<XY> {
    if line.len() < 2 { return line.to_vec(); }
    let mut poly = band.left.clone();
    poly.extend(band.right.iter().rev());
    // рубеж сгущается до точек через 0,5 км, в полосе остаются лежащие внутри
    let dense: Vec<XY> = line.windows(2).flat_map(|w| {
        let n = (w[0].dist(w[1]) / 0.5).ceil().max(1.0) as usize;
        (0..n).map(move |i| lerp(w[0], w[1], i as f64 / n as f64))
    }).chain(std::iter::once(*line.last().unwrap())).collect();
    let kept: Vec<XY> = dense.into_iter().filter(|p| inside(*p, &poly)).collect();
    if !kept.is_empty() { return kept; }
    let axis = center(band);
    for a in axis.windows(2) { for s in line.windows(2) { if let Some(p) = intersect(a[0], a[1], s[0], s[1]) { return vec![p]; } } }
    vec![mean(line)]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Полоса 10 км (y от −5 до 5), ось — с запада на восток на 20 км.
    fn ten() -> Band { Band { left: vec![XY::new(0.0, 5.0), XY::new(20.0, 5.0)], right: vec![XY::new(0.0, -5.0), XY::new(20.0, -5.0)] } }
    fn width(b: &Band) -> f64 { b.left[0].dist(b.right[0]) }
    fn finite(b: &Band) -> bool { b.left.iter().chain(b.right.iter()).all(|p| p.x.is_finite() && p.y.is_finite()) }

    #[test]
    fn split_equal_and_weighted() {
        let p = split(&ten(), &[1.0, 1.0]);
        assert!((width(&p[0]) - 5.0).abs() < 1e-9 && (width(&p[1]) - 5.0).abs() < 1e-9);
        for i in 0..SAMPLES { assert!(p[0].right[i].dist(p[1].left[i]) < 1e-9); }
        let q = split(&ten(), &[2.0, 1.0]);
        assert!((width(&q[0]) - 20.0 / 3.0).abs() < 1e-9 && (width(&q[1]) - 10.0 / 3.0).abs() < 1e-9);
        assert!(p.iter().chain(q.iter()).all(finite));
    }

    #[test]
    fn band_without_and_with_one_boundary() {
        let axis = [XY::new(0.0, 0.0), XY::new(20.0, 0.0)];
        let subs = [XY::new(0.0, 3.0), XY::new(0.0, -3.0)];
        let b = band_of(&axis, &[], &subs, 4.0);
        assert!((width(&b) - 10.0).abs() < 1e-9, "{}", width(&b));
        assert!(b.left[0].y > 0.0 && b.right[0].y < 0.0);
        let one = band_of(&axis, &[(None, vec![XY::new(0.0, 7.0), XY::new(20.0, 8.0)])], &subs, 4.0);
        assert_eq!(one.left, vec![XY::new(0.0, 7.0), XY::new(20.0, 8.0)]);
        assert!((one.right[0].y - one.right[1].y).abs() < 1e-9, "правая параллельна оси");
        assert!(finite(&b) && finite(&one));
        // без оси и без подчинённых — не NaN
        assert!(finite(&band_of(&[], &[], &[], 4.0)));
    }

    #[test]
    fn clip_line_inside_and_point() {
        let cut = clip_line(&[XY::new(10.0, -20.0), XY::new(10.0, 20.0)], &ten());
        assert!(!cut.is_empty() && cut.iter().all(|p| p.y >= -5.0 && p.y <= 5.0 && (p.x - 10.0).abs() < 1e-9));
        assert_eq!(clip_line(&[XY::new(3.0, 4.0)], &ten()), vec![XY::new(3.0, 4.0)]);
        // рубеж вне полосы — центр рубежа
        let off = clip_line(&[XY::new(30.0, 20.0), XY::new(40.0, 20.0)], &ten());
        assert_eq!(off.len(), 1);
    }
}
