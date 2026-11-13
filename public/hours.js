// Opening hours for restaurants and bars (eats.json week arrays: minutes since midnight, Monday first).
// Shared by the downtown model (app.js) and the citywide map (eats.js).

const TZ = 'America/New_York';

// When OSM has no readable hours, guess typical ones so the town still feels right. Shown as a guess.
const typical = (open, close, days = [0, 1, 2, 3, 4, 5, 6]) =>
  Array.from({ length: 7 }, (_, d) => (days.includes(d) ? [[open * 60, close * 60]] : []));
export const GUESS = {
  restaurant: typical(11, 21), takeout: typical(10, 21), cafe: typical(7, 17),
  bar: typical(16, 25), brewery: typical(14, 22), nightclub: typical(21, 26, [3, 4, 5]),
};

export function etNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { day, min: (+parts.hour % 24) * 60 + +parts.minute };
}
export function isOpen(week, { day, min }) {
  if (week[day].some(([a, b]) => min >= a && min < b)) return true;
  return week[(day + 6) % 7].some(([, b]) => b > 1440 && min + 1440 < b);
}
export const fmtMin = (m) => {
  m %= 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
export function openLine(s, now = etNow()) {
  if (isOpen(s.week, now)) {
    const today = s.week[now.day].find(([a, b]) => now.min >= a && now.min < b);
    const end = today ? today[1] : s.week[(now.day + 6) % 7].find(([, b]) => b > 1440)[1];
    return today && today[0] === 0 && today[1] === 1440 ? 'Open 24 hours today' : `Open now, until ${fmtMin(end)}`;
  }
  for (let i = 0; i < 7; i++) {
    const d = (now.day + i) % 7;
    const next = s.week[d].find(([a]) => i > 0 || a > now.min);
    if (next) return `Closed, opens ${i === 0 ? '' : i === 1 ? 'tomorrow ' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d] + ' '}${fmtMin(next[0])}`;
  }
  return 'Closed';
}

