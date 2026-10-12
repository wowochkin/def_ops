//! Маршрут по клеткам театра: A* по времени движения. Дорога — быстро, вне дорог — по местности, вода
//! непроходима; переход через большую реку — по действующему мосту, без моста — только пешим порядком
//! с задержкой форсирования, технике без моста хода нет.

use crate::model::{Mobility, Side};
use crate::rules::Rules;
use crate::theatre::{Theatre, DIRS, WATER};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Предел раскрытых клеток на один поиск (весь театр — около 120 тыс. клеток).
const MAX_EXPANDED: usize = 400_000;

/// Стоимость перехода из клетки `c` в направлении `d`, ч; None — хода нет.
#[inline]
pub fn step_cost(t: &Theatre, r: &Rules, side: Side, mob: Mobility, c: usize, d: usize, bridge_open: &dyn Fn(u16) -> bool) -> Option<(usize, f64)> {
    let nb = t.neighbor(c, d)?;
    if t.terrain[nb] == WATER { return None; }
    // по диагонали между двумя клетками воды не пройти (иначе проливы и протоки «срезаются» углом)
    if d % 2 == 1 {
        let (a, b) = (t.neighbor(c, (d + 7) % 8), t.neighbor(c, (d + 1) % 8));
        if a.map_or(true, |k| t.terrain[k] == WATER) && b.map_or(true, |k| t.terrain[k] == WATER) { return None; }
    }
    let road = t.road[c].min(t.road[nb]);
    let v = r.speed_kmh(side, mob, road, t.terrain[nb], false);
    if v <= 0.0 { return None; }
    let mut h = t.centers[c].dist(t.centers[nb]) / v;
    if t.river_cross[c] & (1 << d) != 0 {
        // пехота переправляется на подручных средствах, технике наводят переправу (march.bridgingHours)
        match t.crossing_bridge.get(&(c as u32, d as u8)) {
            Some(&b) if bridge_open(b) => {}
            _ if mob == Mobility::Foot => h += r.river_cross_hours,
            _ => h += r.bridging_hours,
        }
    }
    Some((nb, h))
}

/// Путь из `from` в `to` (включая обе клетки) и время в часах; None — недостижимо.
pub fn find(t: &Theatre, r: &Rules, side: Side, mob: Mobility, from: usize, to: usize, bridge_open: &dyn Fn(u16) -> bool) -> Option<(Vec<u32>, f64)> {
    if from == to { return Some((vec![from as u32], 0.0)); }
    let n = t.cols * t.rows;
    let vmax = r.march_kmh[mob as usize];
    let goal = t.centers[to];
    let hfn = |c: usize| t.centers[c].dist(goal) / vmax;
    let mut g = vec![f64::INFINITY; n];
    let mut parent = vec![u32::MAX; n];
    let mut closed = vec![false; n];
    let mut heap: BinaryHeap<Reverse<(u64, u32)>> = BinaryHeap::new();
    g[from] = 0.0;
    heap.push(Reverse((hfn(from).to_bits(), from as u32)));
    let mut expanded = 0usize;
    while let Some(Reverse((_, c))) = heap.pop() {
        let c = c as usize;
        if closed[c] { continue; }
        if c == to {
            let mut path = vec![to as u32];
            let mut k = to;
            while k != from { k = parent[k] as usize; path.push(k as u32); }
            path.reverse();
            return Some((path, g[to]));
        }
        closed[c] = true;
        expanded += 1;
        if expanded > MAX_EXPANDED { return None; }
        for d in 0..DIRS.len() {
            let Some((nb, h)) = step_cost(t, r, side, mob, c, d, bridge_open) else { continue };
            if closed[nb] { continue; }
            let ng = g[c] + h;
            if ng < g[nb] {
                g[nb] = ng;
                parent[nb] = c as u32;
                heap.push(Reverse(((ng + hfn(nb)).to_bits(), nb as u32)));
            }
        }
    }
    None
}
