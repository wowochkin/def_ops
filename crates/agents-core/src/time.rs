//! Время модели: шаг — 1 час, отсчёт от начала сценария. Даты в данных — «ГГГГ-ММ-ДДTЧЧ:ММ» или «ГГГГ-ММ-ДД».

/// Часы от 1970-01-01T00:00 (по гражданскому календарю, без часовых поясов).
pub fn parse_hours(s: &str) -> Option<i64> {
    let (date, time) = match s.split_once('T') { Some((d, t)) => (d, Some(t)), None => (s, None) };
    let mut it = date.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    let d: i64 = it.next()?.parse().ok()?;
    let h: i64 = match time { Some(t) => t.split(':').next()?.parse().ok()?, None => 0 };
    Some(days_from_civil(y, m, d) * 24 + h)
}

/// Обратно: часы → «ГГГГ-ММ-ДДTЧЧ:00».
pub fn format_hours(h: i64) -> String {
    let (days, hour) = (h.div_euclid(24), h.rem_euclid(24));
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:00")
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        let h = parse_hours("1945-04-16T03:00").unwrap();
        assert_eq!(format_hours(h), "1945-04-16T03:00");
        assert_eq!(parse_hours("1945-05-01").unwrap() - parse_hours("1945-04-30").unwrap(), 24);
    }
}
