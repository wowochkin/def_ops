//! Генератор случайных чисел со счётчиком: поток чисел агента зависит только от зерна прогона, номера агента,
//! номера шага и назначения. Поэтому результат не зависит от числа потоков и порядка их работы — прогон
//! повторяется точно на любом числе ядер.

/// Перемешивание SplitMix64.
#[inline]
pub fn mix(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Назначения потоков: разные решения одного агента на одном шаге не делят числа.
#[derive(Clone, Copy)]
pub enum Stream {
    Decide = 1,
    Combat = 2,
    Route = 3,
}

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64, agent: u32, tick: u32, stream: Stream) -> Self {
        Rng(mix(seed ^ mix(agent as u64 ^ mix(((tick as u64) << 8) ^ stream as u64))))
    }
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        mix(self.0)
    }
    /// Равномерно на [0, 1).
    #[inline]
    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }
    /// Множитель 1 ± spread.
    #[inline]
    pub fn jitter(&mut self, spread: f64) -> f64 {
        1.0 + spread * (2.0 * self.f64() - 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn same_inputs_same_numbers() {
        let a: Vec<u64> = { let mut r = Rng::new(7, 3, 10, Stream::Decide); (0..5).map(|_| r.next_u64()).collect() };
        let b: Vec<u64> = { let mut r = Rng::new(7, 3, 10, Stream::Decide); (0..5).map(|_| r.next_u64()).collect() };
        assert_eq!(a, b);
        let c = Rng::new(7, 3, 11, Stream::Decide).next_u64();
        assert_ne!(a[0], c);
    }
}
