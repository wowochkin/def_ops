//! Варианты решения командующего: общий вид выбора и перечень видов. Сами варианты строят модули сторон
//! (`options_su` — советские фронты); оценка и выбор — в отдельном модуле.

use super::profile::Motives;
use crate::geo::XY;

/// Что именно командующий решает сделать.
#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    /// Идти по плану, ничего не менять.
    Continue,
    /// Ввести подвижную группу (штаб армии) в прорыв.
    CommitMobile { hq: u32 },
    /// Подождать с вводом подвижной группы.
    WaitMobile,
    /// Перенести главный удар на армии `to`.
    ShiftMainBlow { to: Vec<u32> },
    /// Повернуть армию `hq` к точке `at` (объект соперника).
    TurnToRival { hq: u32, at: XY },
    /// Замкнуть котёл с номером `pocket` в картине обстановки решения (тот же котёл в следующих картинах — по месту).
    Encircle { pocket: usize },
    /// Ввести армию второго эшелона.
    CommitSecond { hq: u32 },
    /// Держаться на месте.
    Hold,
    /// Отвести армию.
    Withdraw { hq: u32 },
    /// Контратаковать армией `from` по точке `at`.
    Counterattack { from: u32, at: XY },
    /// Передать силы от армии `from` армии `to`.
    ShiftForces { from: u32, to: u32 },
    /// Прорываться к точке `toward`.
    Breakout { toward: XY },
    /// Разрешить запрос подчинённого с номером `request`.
    Permit { request: usize },
    /// Отклонить запрос подчинённого с номером `request`.
    Forbid { request: usize },
    /// Выручить армию `army` ударом армии `by` к точке `toward`.
    Relief { army: u32, by: u32, toward: XY },
    /// Переместить резерв `hq` в точку `to`.
    MoveReserve { hq: u32, to: XY },
}

/// Вариант, оцениваемый командующим.
#[derive(Clone, Debug)]
pub struct Choice {
    pub kind: Kind,
    /// Подпись для документа и интерфейса.
    pub label: String,
    /// Вклад варианта в каждый мотив, −1…1.
    pub contrib: Motives,
    /// Неопределённость исхода, 0…1.
    pub uncertainty: f64,
    /// Ожидаемые потери, 0…1.
    pub losses: f64,
    /// Статья ПУ-43 или положение опыта, на которое опирается вариант.
    pub rule: &'static str,
}
