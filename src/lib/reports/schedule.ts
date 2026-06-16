import { addDays, addMonths } from "date-fns";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";

/**
 * Compute the next UTC run time for a schedule, strictly after `from`.
 *  - DAILY:   next day at hourUtc
 *  - WEEKLY:  next occurrence of dayOfWeek (0=Sun..6=Sat) at hourUtc
 *  - MONTHLY: next occurrence of dayOfMonth (1..28) at hourUtc
 * All arithmetic is in UTC to match the cron dispatcher's clock.
 */
export function computeNextRun(
  frequency: Frequency,
  hourUtc: number,
  dayOfWeek: number | null | undefined,
  dayOfMonth: number | null | undefined,
  from: Date = new Date()
): Date {
  const hour = Math.min(Math.max(hourUtc ?? 8, 0), 23);

  if (frequency === "DAILY") {
    let next = atUtcHour(from, hour);
    if (next <= from) next = atUtcHour(addDays(from, 1), hour);
    return next;
  }

  if (frequency === "WEEKLY") {
    const target = clamp(dayOfWeek ?? 1, 0, 6);
    let next = atUtcHour(from, hour);
    let guard = 0;
    while ((next.getUTCDay() !== target || next <= from) && guard < 8) {
      next = atUtcHour(addDays(next, 1), hour);
      guard++;
    }
    return next;
  }

  // MONTHLY
  const targetDom = clamp(dayOfMonth ?? 1, 1, 28);
  let candidate = atUtcHour(setUtcDate(from, targetDom), hour);
  if (candidate <= from) {
    candidate = atUtcHour(setUtcDate(addMonths(from, 1), targetDom), hour);
  }
  return candidate;
}

function atUtcHour(d: Date, hour: number): Date {
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0)
  );
  return out;
}

function setUtcDate(d: Date, day: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day, 0, 0, 0, 0));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
