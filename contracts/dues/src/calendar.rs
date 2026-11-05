//! Calendar arithmetic for monthly due dates, in UTC milliseconds.
//!
//! A retainer due on the 31st falls on the last day of shorter months
//! (Jan 31 -> Feb 28/29 -> Mar 31 would drift, so each step is taken from
//! the anchor day the invoice was created with).

const MS_PER_DAY: i64 = 86_400_000;

/// Days since 1970-01-01 -> (year, month 1..=12, day 1..=31).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// (year, month, day) -> days since 1970-01-01.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = m as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(y) => 29,
        _ => 28,
    }
}

/// Day of month (1..=31) of a UTC millisecond timestamp.
pub fn day_of_month(ts_ms: u64) -> u32 {
    civil_from_days(ts_ms as i64 / MS_PER_DAY).2
}

/// Moves `ts_ms` forward one calendar month, keeping the time of day and
/// using `anchor_day` (clamped to the month length) as the day of month.
pub fn add_one_month(ts_ms: u64, anchor_day: u32) -> u64 {
    let ts = ts_ms as i64;
    let days = ts.div_euclid(MS_PER_DAY);
    let time_of_day = ts.rem_euclid(MS_PER_DAY);
    let (y, m, _) = civil_from_days(days);
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    let nd = anchor_day.clamp(1, days_in_month(ny, nm));
    (days_from_civil(ny, nm, nd) * MS_PER_DAY + time_of_day) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(y: i64, m: u32, d: u32) -> u64 {
        (days_from_civil(y, m, d) * MS_PER_DAY) as u64
    }

    #[test]
    fn round_trips_known_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(days_from_civil(2026, 11, 5)), (2026, 11, 5));
        assert_eq!(civil_from_days(days_from_civil(2028, 2, 29)), (2028, 2, 29));
    }

    #[test]
    fn first_of_month_stays_on_the_first() {
        assert_eq!(add_one_month(ms(2026, 12, 1), 1), ms(2027, 1, 1));
        assert_eq!(add_one_month(ms(2027, 1, 1), 1), ms(2027, 2, 1));
    }

    #[test]
    fn end_of_month_is_clamped_then_restored() {
        let jan31 = ms(2027, 1, 31);
        let feb = add_one_month(jan31, 31);
        assert_eq!(feb, ms(2027, 2, 28));
        assert_eq!(add_one_month(feb, 31), ms(2027, 3, 31));
        assert_eq!(add_one_month(ms(2028, 1, 31), 31), ms(2028, 2, 29));
    }

    #[test]
    fn keeps_time_of_day() {
        let t = ms(2026, 11, 5) + 13 * 3_600_000 + 7;
        assert_eq!(add_one_month(t, 5), ms(2026, 12, 5) + 13 * 3_600_000 + 7);
        assert_eq!(day_of_month(t), 5);
    }
}
