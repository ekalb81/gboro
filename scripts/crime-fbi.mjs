// Monthly citywide crime counts for Greensboro from the FBI's Crime Data Explorer (CDE).
//
// GPD reports to the FBI's NIBRS every month, so this keeps working when the City's own open-data feed
// stalls. It is citywide only (no divisions) and runs 4 to 6 weeks behind. Needs a free api.data.gov key
// in FBI_API_KEY (https://api.data.gov/signup/).

export const GPD_ORI = 'NC0410200';
export const FBI_SOURCE = {
  name: 'FBI Crime Data Explorer, Greensboro Police Department',
  url: `https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend`,
  api: 'https://api.usa.gov/crime/fbi/cde/summarized/agency',
};
const KINDS = { violent: 'violent-crime', property: 'property-crime' };

const mmYYYY = (y, m) => `${String(m).padStart(2, '0')}-${y}`;
const toIso = (k) => `${k.slice(3)}-${k.slice(0, 2)}`; // "09-2026" -> "2026-09"

// The months from `count` months before `now` up to `now`'s month, oldest first, as "MM-YYYY".
export function monthKeys(now, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(mmYYYY(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  return out;
}

// The agency's series out of a CDE "summarized" response: { "MM-YYYY": number|null }.
export function agencySeries(json) {
  const actuals = json?.offenses?.actuals || {};
  const key = Object.keys(actuals).find((k) => /greensboro police/i.test(k) && /offenses/i.test(k));
  return key ? actuals[key] : null;
}

// Pick the newest month that looks complete: it has a number, and it isn't far below the months before it
// (the FBI's newest month fills in over several weeks). Returns its index in `keys`, or -1.
export function newestCompleteMonth(keys, totals, ratio = 0.75) {
  for (let i = keys.length - 1; i >= 1; i--) {
    if (totals[i] == null) continue;
    const before = totals.slice(Math.max(0, i - 4), i).filter((n) => n != null).sort((a, b) => a - b);
    if (before.length < 2) return i;
    if (totals[i] >= ratio * before[before.length >> 1]) return i;
  }
  return -1;
}

export function buildMonthly({ violent, property, keys }) {
  const totals = keys.map((k) => (violent[k] == null || property[k] == null ? null : violent[k] + property[k]));
  const i = newestCompleteMonth(keys, totals);
  if (i < 1 || totals[i - 1] == null) return null;
  const month = (j) => ({ month: toIso(keys[j]), violent: violent[keys[j]], property: property[keys[j]], total: totals[j] });
  return { source: { name: FBI_SOURCE.name, url: FBI_SOURCE.url }, thisMonth: month(i), lastMonth: month(i - 1) };
}

export async function fetchFbiMonthly({ apiKey, now = new Date(), fetchImpl = fetch }) {
  const keys = monthKeys(now, 8);
  const series = {};
  for (const [name, path] of Object.entries(KINDS)) {
    const q = new URLSearchParams({ from: keys[0], to: keys[keys.length - 1], API_KEY: apiKey });
    const r = await fetchImpl(`${FBI_SOURCE.api}/${GPD_ORI}/${path}?${q}`);
    if (!r.ok) throw new Error(`FBI CDE ${r.status}`);
    const s = agencySeries(await r.json());
    if (!s) throw new Error('FBI CDE: no Greensboro series in the response');
    series[name] = s;
  }
  return buildMonthly({ ...series, keys });
}
