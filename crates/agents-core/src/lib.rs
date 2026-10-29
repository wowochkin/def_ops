//! Ядро агентной модели переигровки (docs/plans/agents.md): агенты-дивизии с параметрами, переменными и
//! иерархической машиной состояний, штабы, объекты; часовой шаг в три фазы с параллельным решением агентов
//! и воспроизводимым результатом на любом числе ядер.

pub mod command;
pub mod commander;
pub mod game;
pub mod intent;
pub mod geo;
pub mod llm;
pub mod model;
pub mod pocket;
pub mod rng;
pub mod route;
pub mod rules;
pub mod scenario;
pub mod spatial;
pub mod staff;
pub mod staff_su;
pub mod theatre;
pub mod time;
pub mod trace;
pub mod world;

/// Папка данных `packages/sim/data` относительно корня репозитория.
pub const DATA_DIR: &str = "packages/sim/data";

/// Корень репозитория: от папки крейта на два уровня вверх.
pub fn repo_root() -> String {
    let here = env!("CARGO_MANIFEST_DIR");
    std::path::Path::new(here).join("../..").canonicalize().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| ".".into())
}
