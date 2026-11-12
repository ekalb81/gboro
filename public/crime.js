// Crime in the paper: citywide by month (FBI) and, while the City's feed is current, per GPD division by week.
// Lives in the paper (the side panel) only. Crime is never drawn on the map, pinned to a block or animated.
// Data: data/crime.json from scripts/fetch-crime.mjs.

const fmtDay = (day, opts) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const range = (w) => `${fmtDay(w.start, { month: 'short', day: 'numeric' })} to ${fmtDay(w.end, { month: 'short', day: 'numeric', year: 'numeric' })}`;

// Column headers like "Sep 22-28", so a paused feed never reads as "this week".
const short = (w) => {
  const a = fmtDay(w.start, { month: 'short', day: 'numeric' }), b = fmtDay(w.end, { month: 'short', day: 'numeric' });
  return a.split(' ')[0] === b.split(' ')[0] ? `${a}–${b.split(' ')[1]}` : `${a}–${b}`;
};

const style = document.createElement('style');
style.textContent = `
  #crime table { width:100%; border-collapse:collapse; font-size:12px; margin-top:4px; }
  #crime th, #crime td { padding:3px 4px; text-align:right; border-bottom:1px dotted #c9b88f; }
  #crime th:first-child, #crime td:first-child { text-align:left; }
  #crime th { color:var(--muted); font-weight:normal; white-space:nowrap; }
  #crime tr.total td { font-weight:bold; border-bottom:none; }
  #crime .area { color:var(--muted); }
  #crime .stale { background:#efe0b8; border:2px solid #c9a46a; border-radius:3px; padding:6px; margin:6px 0; font-size:12px; }
  #crime a { color:var(--accent); }
`;
document.head.append(style);

const section = document.createElement('section');
section.id = 'crime';
section.hidden = true;
const about = [...document.querySelectorAll('aside h2')].find((h) => h.textContent.trim() === 'About');
(about ? about.before.bind(about) : document.querySelector('aside').append.bind(document.querySelector('aside')))(section);

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

const monthName = (iso) => new Date(`${iso}-15T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const link = (url, text) => el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', textContent: text });
const row = (label, a, b, cls = '') => el('tr', { className: cls }, el('td', {}, ...[].concat(label)), el('td', { textContent: a }), el('td', { textContent: b }));

// Citywide, by month, from the FBI. Current even when the City's own feed stalls.
function renderMonthly(m) {
  const a = m.thisMonth, b = m.lastMonth;
  section.append(
    el('h2', { textContent: 'Crime by month' }),
    el('div', { className: 'sub', textContent: `Offenses reported by Greensboro Police citywide, ${monthName(a.month)} next to the month before. Monthly figures run about six weeks behind.` }),
    el('table', {},
      el('tr', {}, el('th', { textContent: '' }), el('th', { textContent: monthName(a.month) }), el('th', { textContent: monthName(b.month) })),
      row('Violent', a.violent, b.violent),
      row('Property', a.property, b.property),
      row('Total', a.total, b.total, 'total'),
    ),
    el('div', { className: 'sub' }, 'Source: ', link(m.source.url, 'FBI Crime Data Explorer'), '.'),
  );
}

// Weekly, per police division, from the City's open data.
function renderDivisions(c) {
  section.append(
    el('h2', { textContent: 'Week by district' }),
    el('div', { className: 'sub', textContent: `Reported incidents per police division, ${range(c.thisWeek)}, next to the week before. No addresses.` }),
  );
  if (c.stale && c.latestReport) section.append(el('div', { className: 'stale', textContent: `The City hasn't updated its crime data since ${since(c)}, so this is the latest full week it published.` }));
  const table = el('table', {}, el('tr', {}, el('th', { textContent: 'Division' }), el('th', { textContent: short(c.thisWeek) }), el('th', { textContent: short(c.lastWeek) })));
  for (const d of c.divisions) table.append(row([d.name, ' ', el('span', { className: 'area', textContent: `(${d.area})` })], d.thisWeek.total, d.lastWeek.total));
  if (c.outsideGPD.thisWeek.total || c.outsideGPD.lastWeek.total) table.append(row('Other agencies', c.outsideGPD.thisWeek.total, c.outsideGPD.lastWeek.total));
  table.append(row('Citywide', c.city.thisWeek.total, c.city.lastWeek.total, 'total'));
  const t = c.city.thisWeek;
  section.append(table, el('div', { className: 'sub' },
    `${short(c.thisWeek)}: ${t.violent} violent, ${t.property} property, ${t.other} other. Source: `,
    link(c.source.url, 'City of Greensboro open data'), '.',
  ));
}

const since = (c) => new Date(c.latestReport).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });

function render(c) {
  section.innerHTML = '';
  if (c.monthly) renderMonthly(c.monthly);
  // With current monthly numbers on show, a months-old division table would only confuse, so it waits for the City's feed.
  if (c.divisions && (!c.stale || !c.monthly)) renderDivisions(c);
  else if (c.divisions && c.latestReport) section.append(el('div', { className: 'sub', textContent: `Weekly counts by police division come back when the City resumes its crime data (paused since ${since(c)}).` }));
  section.hidden = !section.childElementCount;
}

async function refresh() {
  try {
    const r = await fetch('data/crime.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    render(await r.json());
  } catch {
    section.hidden = true; // no crime data yet: leave the paper as it was
  }
}

refresh();
setInterval(refresh, 30 * 60e3);
