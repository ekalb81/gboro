// Council meetings and city events (data/civic.json from scripts/civic.mjs).
// City Hall lights up on council nights: windows glow from an hour before the meeting until it ends,
// a flag flies over the clock tower while it's in session, and lamps burn by the door.

const TZ = 'America/New_York';
const etDate = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });

export async function loadCivic() {
  try {
    const r = await fetch('data/civic.json', { cache: 'no-store' });
    if (!r.ok) return { items: [], generatedAt: null };
    return await r.json();
  } catch {
    return { items: [], generatedAt: null };
  }
}

/**
 * Council state right now. Preview with ?council=tonight|session.
 * Returns { meeting, lit, inSession } where lit means City Hall's windows should glow.
 */
export function councilState(items, now = Date.now()) {
  const preview = new URLSearchParams(location.search).get('council');
  if (preview) return { meeting: { title: 'City Council meeting (preview)' }, lit: true, inSession: preview === 'session' };
  const today = etDate(new Date(now));
  for (const it of items) {
    if (it.kind !== 'council' || it.allDay || etDate(new Date(it.start)) !== today) continue;
    const start = Date.parse(it.start), end = it.end ? Date.parse(it.end) : start + 3 * 3600e3;
    if (now > end) continue;
    return { meeting: it, lit: now >= start - 3600e3, inSession: now >= start };
  }
  return { meeting: null, lit: false, inSession: false };
}

/** Warm windows, a glow, door lamps and (in session) a flag. `d` is the downtown district, `wins` its windows. */
export function drawCouncilNight(ctx, d, T, wins, state, t) {
  if (!state.lit) return;
  const x = d.x * T, y = d.y * T, w = d.w * T, h = d.h * T;
  // Warm glow around the building and a pool of light on the street, stepped so it stays pixel-y.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [pad, a] of [[14, 0.035], [9, 0.045], [4, 0.06]]) {
    ctx.fillStyle = `rgba(255,170,60,${a})`;
    ctx.fillRect(x - pad, y - pad + 4, w + pad * 2, h + pad * 2 - 4);
  }
  ctx.fillStyle = 'rgba(255,190,90,.12)';
  ctx.fillRect(x + (w >> 1) - 12, y + h, 24, 6);
  ctx.fillRect(x + (w >> 1) - 7, y + h + 6, 14, 3);
  ctx.restore();
  // Every window lit, with a slow flicker so it reads as people inside.
  for (const [wx, wy, s = 3] of wins) {
    const flick = Math.sin(t / 700 + wx * 0.7 + wy) > 0.85 ? 0.75 : 1;
    ctx.fillStyle = `rgba(255,214,110,${flick})`;
    ctx.fillRect(wx, wy, s, s);
    ctx.fillStyle = 'rgba(255,240,190,.9)';
    ctx.fillRect(wx, wy, 1, 1);
  }
  // Lamps either side of the door.
  const doorX = x + (w >> 1) - 2;
  for (const lx of [doorX - 4, doorX + 7]) {
    ctx.fillStyle = '#3a2618'; ctx.fillRect(lx, y + h - 6, 1, 6);
    ctx.fillStyle = Math.floor(t / 500 + lx) % 4 ? '#ffd66e' : '#ffe9a8';
    ctx.fillRect(lx - 1, y + h - 8, 3, 2);
  }
  if (state.inSession) {
    // Flag on the roof, flapping.
    const px = x + 4, py = y - 9; // on the roof's left corner, clear of the marker over the tower
    ctx.fillStyle = '#4a3020'; ctx.fillRect(px, py, 1, 10);
    const f = Math.floor(t / 250) % 2;
    ctx.fillStyle = '#c8553d'; ctx.fillRect(px + 1, py, 5, 2);
    ctx.fillStyle = '#f3ead2'; ctx.fillRect(px + 1, py + 2, 5 - f, 1);
    ctx.fillStyle = '#2f3f6b'; ctx.fillRect(px + 1, py + 3, 5 - f, 1);
  }
}

/** A line for the status bar, e.g. "City Council meets tonight at 5:30 PM". */
export function councilLine(state) {
  if (!state.meeting) return '';
  if (!state.meeting.start) return `${state.meeting.title}: City Hall is lit`;
  const at = new Date(state.meeting.start).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  return state.inSession ? `City Council is in session at City Hall (since ${at})` : `City Council meets tonight at ${at}`;
}
