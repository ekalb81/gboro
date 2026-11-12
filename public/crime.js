// "Week by district": reported crime per GPD division, this week next to last week.
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

function render(c) {
  section.innerHTML = '';
  section.append(
    el('h2', { textContent: 'Week by district' }),
    el('div', { className: 'sub', textContent: `Reported incidents per police division, ${range(c.thisWeek)}, next to the week before. No addresses.` }),
  );
  if (c.stale && c.latestReport) {
    const since = new Date(c.latestReport).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
    section.append(el('div', { className: 'stale', textContent: `The City hasn't updated its crime data since ${since}, so this is the latest full week it published.` }));
  }
  const table = el('table', {},
    el('tr', {}, el('th', { textContent: 'Division' }), el('th', { textContent: short(c.thisWeek) }), el('th', { textContent: short(c.lastWeek) })),
  );
  for (const d of c.divisions) {
    table.append(el('tr', {},
      el('td', {}, d.name, ' ', el('span', { className: 'area', textContent: `(${d.area})` })),
      el('td', { textContent: d.thisWeek.total }),
      el('td', { textContent: d.lastWeek.total }),
    ));
  }
  if (c.outsideGPD.thisWeek.total || c.outsideGPD.lastWeek.total) {
    table.append(el('tr', {},
      el('td', { className: 'area', textContent: 'Other agencies' }),
      el('td', { textContent: c.outsideGPD.thisWeek.total }),
      el('td', { textContent: c.outsideGPD.lastWeek.total }),
    ));
  }
  table.append(el('tr', { className: 'total' },
    el('td', { textContent: 'Citywide' }),
    el('td', { textContent: c.city.thisWeek.total }),
    el('td', { textContent: c.city.lastWeek.total }),
  ));
  const t = c.city.thisWeek;
  section.append(table, el('div', { className: 'sub' },
    `${short(c.thisWeek)}: ${t.violent} violent, ${t.property} property, ${t.other} other. Source: `,
    el('a', { href: c.source.url, target: '_blank', rel: 'noopener noreferrer', textContent: 'City of Greensboro open data' }),
    '.',
  ));
  section.hidden = false;
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
