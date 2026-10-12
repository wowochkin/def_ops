//! Пространственный индекс дивизий на шаг: корзины по квадратам, только чтение в параллельной фазе.

use crate::geo::XY;
use std::collections::HashMap;

pub struct Index {
    cell: f64,
    buckets: HashMap<(i32, i32), Vec<u32>>,
}

impl Index {
    pub fn build(points: impl Iterator<Item = (u32, XY)>, cell: f64) -> Index {
        let mut buckets: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        for (i, p) in points { buckets.entry(Self::key(p, cell)).or_default().push(i); }
        Index { cell, buckets }
    }
    #[inline]
    fn key(p: XY, cell: f64) -> (i32, i32) { ((p.x / cell).floor() as i32, (p.y / cell).floor() as i32) }

    /// Все индексы в радиусе `r` от `p` (кандидаты; расстояние проверяет вызывающий), по возрастанию индекса.
    pub fn near(&self, p: XY, r: f64) -> Vec<u32> {
        let (k0, k1) = (Self::key(XY::new(p.x - r, p.y - r), self.cell), Self::key(XY::new(p.x + r, p.y + r), self.cell));
        let mut out = Vec::new();
        for kx in k0.0..=k1.0 {
            for ky in k0.1..=k1.1 {
                if let Some(v) = self.buckets.get(&(kx, ky)) { out.extend_from_slice(v); }
            }
        }
        out.sort_unstable();
        out
    }
}
