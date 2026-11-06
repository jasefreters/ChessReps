// Spaced-repetition scheduling (a simplified SM-2).
//
// Each position where it is your turn is a card. Cards move through:
//   new      -> never seen
//   learning -> seen recently or forgotten; comes back within minutes
//   review   -> learned; comes back after `interval` days
//
// Grades: 'good' (right first time), 'hard' (right after a hint),
// 'again' (wrong move or answer shown).

export const MINUTE = 60_000;
export const DAY = 86_400_000;
/** Learning cards due within this window are still drilled in the current session. */
export const LOOKAHEAD = 10 * MINUTE;

export function newCard() {
  return { state: 'new', reps: 0, interval: 0, ease: 2.5, due: 0, lapses: 0, last: 0 };
}

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t, days) {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function dayKey(t) {
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** First time a move is shown to you: quiz it again in a minute. */
export function introduce(card, now = Date.now()) {
  const c = { ...newCard(), ...(card || {}) };
  c.state = 'learning';
  c.reps = 0;
  c.interval = 0;
  c.due = now + MINUTE;
  c.last = now;
  return c;
}

export function schedule(card, grade, now = Date.now(), rand = Math.random) {
  const c = { ...newCard(), ...(card || {}) };
  c.last = now;

  if (grade === 'again') {
    if (c.state === 'review') {
      c.lapses += 1;
      c.ease = Math.max(1.3, c.ease - 0.2);
    }
    c.state = 'learning';
    c.reps = 0;
    c.interval = 0;
    c.due = now + MINUTE;
    return c;
  }

  if (grade === 'hard') c.ease = Math.max(1.3, c.ease - 0.15);

  let interval;
  if (c.state !== 'review') {
    interval = 1; // graduate from learning
  } else if (grade === 'hard') {
    interval = Math.max(1, Math.round(c.interval * 1.2));
  } else if (c.reps <= 1) {
    interval = 3;
  } else {
    interval = Math.max(c.interval + 1, Math.round(c.interval * c.ease));
  }
  if (interval >= 4) {
    // Small fuzz so cards learned together don't all come back on the same day.
    interval += Math.round((rand() * 2 - 1) * interval * 0.05);
  }

  c.state = 'review';
  c.reps += 1;
  c.interval = interval;
  c.due = addDays(now, interval);
  return c;
}

/** True when a card you've seen is due for review now. */
export function isDue(card, now = Date.now()) {
  return Boolean(card) && card.state !== 'new' && card.due <= now;
}
