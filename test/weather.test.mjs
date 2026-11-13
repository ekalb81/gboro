import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, normalizeWeather, fetchWeather } from '../scripts/weather.mjs';

// Trimmed to the fields we read; shapes follow api.weather.gov responses.
const obs = (textDescription, cloudLayers = [], tempC = 11.1, windKmh = 14.8) => ({
  properties: {
    timestamp: '2026-11-12T00:54:00+00:00',
    textDescription,
    temperature: { unitCode: 'wmoUnit:degC', value: tempC },
    windSpeed: { unitCode: 'wmoUnit:km_h-1', value: windKmh },
    cloudLayers: cloudLayers.map((amount) => ({ base: { value: 1200 }, amount })),
  },
});

test('converts units and keeps the NWS description', () => {
  const w = normalizeWeather(obs('Light Rain', ['OVC']), { features: [] });
  assert.equal(w.tempF, 52);
  assert.equal(w.windMph, 9);
  assert.equal(w.text, 'Light Rain');
  assert.deepEqual([w.sky, w.precip, w.intensity, w.fog], ['cloudy', 'rain', 'light', false]);
});

test('classifies the sky', () => {
  assert.equal(classify('Clear', ['CLR']).sky, 'clear');
  assert.equal(classify('Partly Cloudy', ['SCT']).sky, 'partly');
  assert.equal(classify('Mostly Cloudy', ['SCT', 'BKN']).sky, 'cloudy');
  assert.equal(classify('Overcast').sky, 'cloudy'); // no layers reported
  assert.equal(classify('Thunderstorms and Rain').precip, 'storm');
  assert.equal(classify('Heavy Rain').intensity, 'heavy');
  assert.equal(classify('Light Snow and Fog/Mist').precip, 'snow');
  assert.equal(classify('Light Snow and Fog/Mist').fog, true);
  assert.equal(classify('Freezing Rain').precip, 'snow');
  assert.equal(classify('Freezing Drizzle').precip, 'snow');
  assert.deepEqual([classify('Freezing Fog').precip, classify('Freezing Fog').fog], ['none', true]);
  assert.equal(classify('').precip, 'none');
});

test('keeps only alerts that have not ended', () => {
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const past = new Date(Date.now() - 3600e3).toISOString();
  const w = normalizeWeather(obs('Clear'), {
    features: [
      { properties: { event: 'Wind Advisory', headline: 'Wind Advisory until 6 PM', severity: 'Moderate', ends: soon } },
      { properties: { event: 'Frost Advisory', headline: 'old', severity: 'Minor', ends: past } },
    ],
  });
  assert.deepEqual(w.alerts.map((a) => a.event), ['Wind Advisory']);
});

test('fetchWeather calls the station and alert endpoints with a User-Agent', async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push([url, opts.headers['user-agent']]);
    return { ok: true, json: async () => (url.includes('/alerts') ? { features: [] } : obs('Fog/Mist', ['OVC'])) };
  };
  const w = await fetchWeather(fake);
  assert.equal(w.fog, true);
  assert.ok(calls.some(([u]) => u.endsWith('/stations/KGSO/observations/latest')));
  assert.ok(calls.some(([u]) => u.includes('/alerts/active?point=')));
  assert.ok(calls.every(([, ua]) => ua));
});
