// Turn National Weather Service API responses into the small weather.json the village reads.
// Observation: https://api.weather.gov/stations/KGSO/observations/latest (Piedmont Triad airport)
// Alerts:      https://api.weather.gov/alerts/active?point=36.0726,-79.792

export const NWS = {
  station: 'KGSO',
  point: '36.0726,-79.792', // downtown Greensboro
  base: 'https://api.weather.gov',
  userAgent: 'gso-village (hobby community map)',
};

const cToF = (c) => (c == null ? null : Math.round(c * 9 / 5 + 32));
const kmhToMph = (k) => (k == null ? null : Math.round(k * 0.621371));
const SKY_RANK = { CLR: 0, SKC: 0, FEW: 1, SCT: 1, BKN: 2, OVC: 2, VV: 2 };

/** What the sky is doing, from the NWS text plus cloud layers. */
export function classify(text = '', cloudLayers = []) {
  const t = text.toLowerCase();
  let precip = 'none';
  if (/thunder|t-storm|tstm/.test(t)) precip = 'storm';
  else if (/snow|sleet|flurr|ice pellets|freezing (rain|drizzle)/.test(t)) precip = 'snow';
  else if (/rain|shower|drizzle/.test(t)) precip = 'rain';

  let intensity = 'moderate';
  if (/light|drizzle|flurr/.test(t)) intensity = 'light';
  if (/heavy/.test(t)) intensity = 'heavy';
  if (precip === 'none') intensity = null;

  const rank = Math.max(-1, ...cloudLayers.map((l) => SKY_RANK[l.amount] ?? -1));
  let sky = rank === 2 ? 'cloudy' : rank === 1 ? 'partly' : rank === 0 ? 'clear' : null;
  if (!sky) sky = /overcast|cloudy/.test(t) && !/partly|mostly clear/.test(t) ? 'cloudy' : /partly|few clouds|mostly clear/.test(t) ? 'partly' : 'clear';
  if (precip !== 'none') sky = 'cloudy';
  const fog = /fog|mist|haze|smoke/.test(t);
  return { sky, precip, intensity, fog };
}

export function normalizeWeather(observation, alerts) {
  const p = observation?.properties ?? {};
  const now = Date.now();
  return {
    observedAt: p.timestamp ?? null,
    station: NWS.station,
    text: p.textDescription || null,
    tempF: cToF(p.temperature?.value),
    windMph: kmhToMph(p.windSpeed?.value),
    windGustMph: kmhToMph(p.windGust?.value),
    windFromDeg: p.windDirection?.value ?? null, // where the wind blows from, degrees clockwise from north
    ...classify(p.textDescription || '', p.cloudLayers || []),
    alerts: (alerts?.features ?? [])
      .map((f) => f.properties)
      .filter((a) => a && (!a.ends || new Date(a.ends).getTime() > now))
      .map((a) => ({ event: a.event, headline: a.headline, severity: a.severity, ends: a.ends || a.expires || null })),
  };
}

export async function fetchWeather(fetchImpl = fetch) {
  const get = async (path) => {
    const r = await fetchImpl(NWS.base + path, { headers: { 'user-agent': NWS.userAgent, accept: 'application/geo+json' } });
    if (!r.ok) throw new Error(`NWS ${path}: HTTP ${r.status}`);
    return r.json();
  };
  const [obs, alerts] = await Promise.all([
    get(`/stations/${NWS.station}/observations/latest`),
    get(`/alerts/active?point=${NWS.point}`),
  ]);
  return normalizeWeather(obs, alerts);
}
