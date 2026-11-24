use agents_core::rng::{Rng, Stream};

/// Назначения современного адаптера отображаются в независимые потоки общего RNG.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModernStream {
    Decision,
    Observation,
    Communication,
    Execution,
}

impl ModernStream {
    fn core(self) -> Stream {
        match self {
            Self::Decision => Stream::Decide,
            Self::Observation => Stream::Fog,
            Self::Communication => Stream::Route,
            Self::Execution => Stream::Combat,
        }
    }
}

/// Локальный счётчик не связан с официальным генератором и существует только внутри оценки.
pub struct SeededModernRng {
    inner: Rng,
    cursor: u64,
}

impl SeededModernRng {
    pub fn new(seed: u64, agent: u32, tick: u32, stream: ModernStream) -> Self {
        Self {
            inner: Rng::new(seed, agent, tick, stream.core()),
            cursor: 0,
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.cursor += 1;
        self.inner.next_u64()
    }

    pub fn cursor(&self) -> u64 {
        self.cursor
    }
}
