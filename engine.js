// Shoot Radar engine — shared by the web app (browser) and the alert runner (Node 20+).
// Data: Open-Meteo forecast + marine APIs (free, no key), NOAA SWPC Kp (aurora).
// Astronomy (sun, moon, Milky Way core) is computed locally.

export const TZ = 'Australia/Melbourne';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const HOUR = 3600e3;
const norm360 = (x) => ((x % 360) + 360) % 360;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * clamp(t);

// ---------------------------------------------------------------- conditions
// `min` = score (0-100) at or above which the condition triggers an alert.
export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassName = (deg) => COMPASS[Math.round(norm360(deg) / 22.5) % 16];
const TIDE = { label: 'Tide', type: 'select', options: { any: 'Any tide', low: 'Low tide', mid: 'Mid tide', high: 'High tide' }, value: 'any' };

export const CONDITIONS = {
  sunrise:  { label: 'Sunrise colour',   icon: 'sunrise', min: 60, params: { tide: TIDE },
              help: 'Mid/high cloud to light up, clear low horizon to the east.' },
  sunset:   { label: 'Sunset colour',    icon: 'sunset',  min: 60, params: { tide: TIDE },
              help: 'Mid/high cloud to light up, clear low horizon to the west.' },
  fog:      { label: 'Foggy sunrise',    icon: 'fog',     min: 55, params: { tide: TIDE },
              help: 'Low visibility, saturated air and light wind around dawn.' },
  swell:    { label: 'Big swell',        icon: 'wave',    min: 55,
              params: { height: { label: 'Swell height (m)', value: 3, step: 0.5, min: 0.5, max: 10 },
                        dir: { label: 'Exposed to swell from', type: 'compass', value: -1 },
                        spread: { label: '± degrees', value: 60, step: 15, min: 15, max: 180 },
                        tide: TIDE },
              help: 'Swell height, period and direction during daylight; bonus in golden hour.' },
  storm:    { label: 'Electrical storm', icon: 'bolt',    min: 50, params: { tide: TIDE },
              help: 'Forecast thunderstorms and instability (CAPE); bonus after dark.' },
  lightning:{ label: 'Live lightning',   icon: 'strike',  min: 0, live: true,
              params: { radius: { label: 'Within (km)', value: 40, step: 5, min: 5, max: 150 },
                        strikes: { label: 'Min strikes', value: 3, step: 1, min: 1, max: 50 } },
              help: 'Real-time strikes near this spot (Blitzortung network), pushed as it happens.' },
  milkyway: { label: 'Milky Way night',  icon: 'stars',   min: 55,
              params: { maxCloud: { label: 'Max cloud (%)', value: 20, step: 5, min: 0, max: 60 }, tide: TIDE },
              help: 'Astronomical darkness, moon down, clear sky; bonus when the core is up.' },
  aurora:   { label: 'Aurora australis', icon: 'aurora',  min: 40,
              params: { kp: { label: 'Min Kp', value: 5, step: 0.5, min: 3, max: 9 }, tide: TIDE },
              help: 'NOAA Kp forecast during darkness, clear sky to the south.' },
  wind:     { label: 'Wild wind',        icon: 'wind',    min: 50,
              params: { gust: { label: 'Gusts (km/h)', value: 75, step: 5, min: 30, max: 150 }, tide: TIDE },
              help: 'Damaging-strength gusts: wild seas, spray, moving cloud.' },
  rainbow:  { label: 'Rainbow chance',   icon: 'rainbow', min: 55, params: { tide: TIDE },
              help: 'Showers with low sun (morning or late afternoon) and broken cloud.' },
  moon:     { label: 'Full moonrise',    icon: 'moon',    min: 55, params: { tide: TIDE },
              help: 'Near-full moon rising within an hour of sunset (or setting near sunrise).' },
  snow:     { label: 'Snowfall',         icon: 'snow',    min: 50,
              params: { cm: { label: 'Snow (cm/day)', value: 2, step: 1, min: 1, max: 50 } },
              help: 'Fresh snow forecast. Mostly useful for alpine and high spots.' },
};

// `learned` (optional) = output of learnThresholds(); its min replaces the manual one.
export function condSettings(loc, key, learned) {
  const def = CONDITIONS[key];
  const c = (loc.conditions && loc.conditions[key]) || {};
  const params = {};
  for (const [p, spec] of Object.entries(def.params)) params[p] = c[p] ?? spec.value;
  const base = c.min ?? def.min, L = learned?.[`${loc.id}|${key}`];
  return { on: !!c.on, min: L?.min ?? base, baseMin: base, learned: L || null, ...params };
}

// ---------------------------------------------------------------- learning from ratings
// ratings: {id: {rating: 'epic'|'ok'|'dud', score, key, locId}}. Needs 3+ ratings per spot+condition.
// Picks the threshold that best separates good shoots (epic/ok) from duds, within ±15 of the manual one.
export function learnThresholds(ratings, config) {
  const groups = {}, out = {};
  for (const r of Object.values(ratings || {})) if (r && r.rating && r.locId && r.key && isFinite(r.score)) (groups[`${r.locId}|${r.key}`] ||= []).push(r);
  for (const [k, rs] of Object.entries(groups)) {
    const [locId, key] = k.split('|');
    const loc = config.locations.find((l) => l.id === locId); if (!loc || !CONDITIONS[key] || CONDITIONS[key].live) continue;
    const base = condSettings(loc, key).baseMin;
    const good = rs.filter((r) => r.rating !== 'dud').length, dud = rs.length - good;
    if (rs.length < 3) { out[k] = { n: rs.length, good, dud, base }; continue; }
    let best = base, bestFit = -1;
    for (let t = 20; t <= 95; t += 5) {
      const fit = rs.reduce((s, r) => s + (((r.rating !== 'dud') === (r.score >= t)) ? (r.rating === 'epic' ? 1.5 : 1) : 0), 0);
      if (fit > bestFit || (fit === bestFit && Math.abs(t - base) < Math.abs(best - base))) { bestFit = fit; best = t; }
    }
    best = Math.round(Math.max(base - 15, Math.min(base + 15, best)) / 5) * 5;
    out[k] = { n: rs.length, good, dud, base, min: best };
  }
  return out;
}

// ---------------------------------------------------------------- astronomy
const daysJ2000 = (ms) => ms / 86400000 + 2440587.5 - 2451545.0;

function sunEcl(d) {
  const g = norm360(357.529 + 0.98560028 * d);
  const q = norm360(280.459 + 0.98564736 * d);
  const lon = norm360(q + 1.915 * Math.sin(g * D2R) + 0.020 * Math.sin(2 * g * D2R));
  return { lon, lat: 0 };
}
function moonEcl(d) {
  const L = 218.316 + 13.176396 * d, M = 134.963 + 13.064993 * d;
  const F = 93.272 + 13.229350 * d, D = 297.850 + 12.190749 * d, Ms = 357.529 + 0.98560028 * d;
  const s = (x) => Math.sin(norm360(x) * D2R);
  const lon = L + 6.289 * s(M) + 1.274 * s(2 * D - M) + 0.658 * s(2 * D) + 0.214 * s(2 * M)
    - 0.186 * s(Ms) - 0.114 * s(2 * F) - 0.059 * s(2 * D - 2 * M) - 0.057 * s(2 * D - Ms - M)
    + 0.053 * s(2 * D + M) + 0.046 * s(2 * D - Ms) - 0.041 * s(Ms - M);
  const lat = 5.128 * s(F) + 0.281 * s(M + F) + 0.278 * s(M - F) + 0.173 * s(2 * D - F);
  return { lon: norm360(lon), lat };
}
function eclToEq({ lon, lat }, d) {
  const e = (23.439 - 0.00000036 * d) * D2R, l = lon * D2R, b = lat * D2R;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra: norm360(ra * R2D), dec: dec * R2D };
}
function altAz({ ra, dec }, d, lat, lon) {
  const lst = norm360(280.46061837 + 360.98564736629 * d + lon);
  const H = norm360(lst - ra) * D2R, phi = lat * D2R, del = dec * D2R;
  const alt = Math.asin(Math.sin(phi) * Math.sin(del) + Math.cos(phi) * Math.cos(del) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(del) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { alt: alt * R2D, az: norm360(az * R2D) };
}
export function sunPos(ms, lat, lon) { const d = daysJ2000(ms); return altAz(eclToEq(sunEcl(d), d), d, lat, lon); }
export function moonPos(ms, lat, lon) {
  const d = daysJ2000(ms); const p = altAz(eclToEq(moonEcl(d), d), d, lat, lon);
  p.alt -= 0.9507 * Math.cos(p.alt * D2R); // topocentric parallax
  return p;
}
export function moonPhase(ms) {
  const d = daysJ2000(ms), m = moonEcl(d), s = sunEcl(d);
  const cosPsi = Math.cos(m.lat * D2R) * Math.cos((m.lon - s.lon) * D2R);
  const elong = norm360(m.lon - s.lon);
  return { illum: (1 - cosPsi) / 2, waxing: elong < 180 };
}
export function moonPhaseName(ms) {
  const { illum, waxing } = moonPhase(ms);
  if (illum < 0.03) return 'New moon';
  if (illum > 0.97) return 'Full moon';
  if (Math.abs(illum - 0.5) < 0.06) return waxing ? 'First quarter' : 'Last quarter';
  return (waxing ? 'Waxing ' : 'Waning ') + (illum < 0.5 ? 'crescent' : 'gibbous');
}
const GC = { ra: 266.405, dec: -28.936 }; // galactic centre
export function corePos(ms, lat, lon) { const d = daysJ2000(ms); return altAz(GC, d, lat, lon); }

// azimuth of the sun at the sunrise/sunset that falls in the given 24h window
export function sunEventAz(lat, lon, fromMs, rising) {
  let prev = sunPos(fromMs, lat, lon).alt;
  for (let t = fromMs + 5 * 60e3; t < fromMs + 86400e3; t += 5 * 60e3) {
    const p = sunPos(t, lat, lon);
    if (rising ? (prev < -0.833 && p.alt >= -0.833) : (prev > -0.833 && p.alt <= -0.833)) return p.az;
    prev = p.alt;
  }
  return rising ? 90 : 270;
}
export function offsetPoint(lat, lon, az, km) {
  const dLat = (km * Math.cos(az * D2R)) / 111.2;
  const dLon = (km * Math.sin(az * D2R)) / (111.2 * Math.cos(lat * D2R));
  return { lat: +(lat + dLat).toFixed(4), lon: +(lon + dLon).toFixed(4) };
}

export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
export function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * D2R) * Math.cos(b.lat * D2R);
  const x = Math.cos(a.lat * D2R) * Math.sin(b.lat * D2R) - Math.sin(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos((b.lon - a.lon) * D2R);
  return norm360(Math.atan2(y, x) * R2D);
}

// ---------------------------------------------------------------- time helpers
const fmtCache = {};
function fmt(opts) { const k = JSON.stringify(opts); return fmtCache[k] ||= new Intl.DateTimeFormat('en-AU', { timeZone: TZ, ...opts }); }
export function localParts(ms) {
  const o = {}; for (const p of fmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(ms)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, wd: o.weekday, key: `${o.year}-${o.month}-${o.day}` };
}
export function utcOffsetHours(ms) {
  const p = localParts(ms); return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60e3) * 60e3) / HOUR);
}
export const fmtTime = (ms) => fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).format(ms).replace(' ', '').toLowerCase();
export function fmtDay(ms, now = Date.now()) {
  const a = localParts(ms).key, t = localParts(now).key, tm = localParts(now + 86400e3).key;
  if (a === t) return 'Today'; if (a === tm) return 'Tomorrow';
  return fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
}
export const fmtWhen = (ms, now) => `${fmtDay(ms, now)} ${fmtTime(ms)}`;

// ---------------------------------------------------------------- fetching
const HOURLY = 'temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_gusts_10m,cape,snowfall,is_day';
const MARINE = 'wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_level_height_msl';
const DAYS = 5;

async function getJSON(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}

// Fetch everything needed for one location. Returns {wx, east, west, south, marine, errors}.
export async function fetchLocation(loc, fetchImpl = fetch, now = Date.now()) {
  const errors = [];
  const day0 = now - (now % 86400e3) - 14 * HOUR; // roughly local midnight-ish, start of scan window
  const eAz = sunEventAz(loc.lat, loc.lon, day0, true), wAz = sunEventAz(loc.lat, loc.lon, day0, false);
  const pts = [{ lat: loc.lat, lon: loc.lon }, offsetPoint(loc.lat, loc.lon, eAz, 50), offsetPoint(loc.lat, loc.lon, wAz, 50), offsetPoint(loc.lat, loc.lon, 180, 60)];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${pts.map((p) => p.lat).join(',')}&longitude=${pts.map((p) => p.lon).join(',')}`
    + `&hourly=${HOURLY}&daily=sunrise,sunset&timezone=${encodeURIComponent(TZ)}&timeformat=unixtime&forecast_days=${DAYS}&past_days=1`;
  let wx = null, east = null, west = null, south = null;
  try {
    const arr = await getJSON(url, fetchImpl);
    [wx, east, west, south] = Array.isArray(arr) ? arr : [arr, null, null, null];
  } catch (e) { errors.push('weather: ' + e.message); }

  let marine = null;
  const wantsSea = Object.entries(loc.conditions || {}).some(([k, c]) => c?.on && (k === 'swell' || (c.tide && c.tide !== 'any')));
  if (wantsSea) {
    const tries = loc.swellLat != null ? [{ lat: loc.swellLat, lon: loc.swellLon }]
      : [{ lat: loc.lat, lon: loc.lon }, { lat: loc.lat - 0.06, lon: loc.lon }, { lat: loc.lat - 0.15, lon: loc.lon }];
    for (const p of tries) {
      try {
        const m = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${p.lat}&longitude=${p.lon}&hourly=${MARINE}&timezone=${encodeURIComponent(TZ)}&timeformat=unixtime&forecast_days=${DAYS}&past_days=1`, fetchImpl);
        if (m.hourly && m.hourly.wave_height?.some((v) => v != null)) { marine = m; marine.point = p; break; }
      } catch (e) { errors.push('sea: ' + e.message); break; }
    }
    if (!marine && !errors.some((e) => e.startsWith('marine'))) errors.push('sea: no ocean data near this point (set a sea point offshore in the editor)');
  }
  return { wx, east, west, south, marine, errors };
}

export async function fetchKp(fetchImpl = fetch) {
  try {
    const raw = await getJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', fetchImpl);
    return parseKp(raw);
  } catch (e) { return { blocks: [], error: e.message }; }
}
export function parseKp(raw) {
  let rows = raw;
  if (Array.isArray(raw) && Array.isArray(raw[0])) {
    const head = raw[0]; rows = raw.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  const blocks = (rows || []).map((r) => ({ t: Date.parse(String(r.time_tag).replace(' ', 'T') + (/[zZ+]/.test(String(r.time_tag).slice(10)) ? '' : 'Z')), kp: parseFloat(r.kp ?? r.Kp ?? r.kp_index), kind: r.observed || r.kind || '' }))
    .filter((b) => isFinite(b.t) && isFinite(b.kp));
  return { blocks };
}
export function kpAt(kp, ms) {
  const b = kp.blocks.find((x) => ms >= x.t && ms < x.t + 3 * HOUR); return b ? b.kp : null;
}

// ---------------------------------------------------------------- evaluation
function series(api) {
  if (!api || !api.hourly) return null;
  const t = api.hourly.time.map((s) => s * 1000);
  const at = (ms) => { // nearest-hour index
    let i = Math.round((ms - t[0]) / HOUR); return i >= 0 && i < t.length ? i : -1;
  };
  return { t, h: api.hourly, at, v: (k, i) => (i < 0 ? null : api.hourly[k]?.[i] ?? null) };
}
const pct = (x) => `${Math.round(x)}%`;

function glowScore(S, i, H, j) {
  const high = S.v('cloud_cover_high', i) ?? 0, mid = S.v('cloud_cover_mid', i) ?? 0, low = S.v('cloud_cover_low', i) ?? 0;
  const hzLow = H && j >= 0 ? (H.v('cloud_cover_low', j) ?? low) : low;
  const canvas = 1 - (1 - high / 100) * (1 - mid / 100);
  let cf;
  if (canvas < 0.1) cf = 0.25; else if (canvas < 0.3) cf = lerp(0.25, 0.9, (canvas - 0.1) / 0.2);
  else if (canvas <= 0.7) cf = 1; else if (canvas < 0.9) cf = lerp(1, 0.5, (canvas - 0.7) / 0.2); else cf = lerp(0.5, 0.15, (canvas - 0.9) / 0.1);
  const block = Math.max(hzLow * 0.95, low * 0.6) / 100;
  const pp = S.v('precipitation_probability', i) ?? 0;
  let s = cf * (1 - Math.pow(block, 1.1) * 0.92) * (1 - (pp / 100) * 0.45);
  let rainBefore = 0; for (let k = 1; k <= 3; k++) rainBefore += S.v('precipitation', i - k) ?? 0;
  const clearing = rainBefore > 0.3 && (S.v('precipitation', i) ?? 0) < 0.1;
  if (clearing) s += 0.1;
  const why = `Mid/high cloud ${pct(canvas * 100)}, low cloud ${pct(low)} here / ${pct(hzLow)} on the horizon` + (clearing ? ', clearing after rain' : '') + (pp >= 30 ? `, ${pct(pp)} rain chance` : '');
  return { score: Math.round(100 * clamp(s)), why };
}

function fogLikelihood(S, i) {
  const vis = S.v('visibility', i), rh = S.v('relative_humidity_2m', i) ?? 0;
  const spread = (S.v('temperature_2m', i) ?? 10) - (S.v('dew_point_2m', i) ?? 0), wind = S.v('wind_speed_10m', i) ?? 20;
  let f = 0;
  if (vis != null) f = vis <= 500 ? 1 : vis <= 1000 ? 0.85 : vis <= 2000 ? 0.6 : vis <= 5000 ? 0.25 : 0;
  if (spread <= 0.6 && rh >= 97 && wind < 7) f = Math.max(f, 0.8);
  else if (spread <= 1.5 && rh >= 93 && wind < 11) f = Math.max(f, 0.5);
  if (wind > 18) f *= 0.4;
  return { f, vis, rh, wind };
}

// ---------------------------------------------------------------- tides (Open-Meteo sea level incl. tide + surge)
function tideAt(M, t) {
  if (!M || !M.h.sea_level_height_msl) return null;
  const lv = (ms) => { const x = (ms - M.t[0]) / HOUR, i = Math.floor(x); const a = M.h.sea_level_height_msl[i], b = M.h.sea_level_height_msl[i + 1]; return a == null || b == null ? (a ?? b ?? null) : a + (b - a) * (x - i); };
  const level = lv(t); if (level == null) return null;
  let lo = Infinity, hi = -Infinity;
  for (let k = -7; k <= 7; k++) { const v = lv(t + k * HOUR); if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!(hi - lo > 0.05)) return null;
  const frac = (level - lo) / (hi - lo), next = lv(t + 0.5 * HOUR);
  return { frac, level, rising: next != null && next > level };
}
function tideMatch(pref, frac) {
  if (pref === 'high') return clamp((frac - 0.35) / 0.45);
  if (pref === 'low') return clamp((0.65 - frac) / 0.45);
  if (pref === 'mid') return clamp(1 - Math.abs(frac - 0.5) / 0.35);
  return 1;
}
const tideWord = (f) => (f >= 0.75 ? 'high' : f <= 0.25 ? 'low' : 'mid');
export function tideExtremes(api) {
  const S = series(api); if (!S || !S.h.sea_level_height_msl) return [];
  const v = S.h.sea_level_height_msl, out = [];
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] == null || v[i - 1] == null || v[i + 1] == null) continue;
    const isHi = v[i] >= v[i - 1] && v[i] > v[i + 1], isLo = v[i] <= v[i - 1] && v[i] < v[i + 1];
    if (!isHi && !isLo) continue;
    const den = v[i - 1] - 2 * v[i] + v[i + 1]; const off = den ? clamp(0.5 * (v[i - 1] - v[i + 1]) / den, -0.5, 0.5) : 0; // parabolic peak
    out.push({ t: S.t[i] + off * HOUR, type: isHi ? 'high' : 'low', level: v[i] - 0.25 * (v[i - 1] - v[i + 1]) * off });
  }
  return out;
}

// Returns a flat list of events for one location (all scores, alert flag set by threshold).
export function evaluateLocation(loc, data, kp, now = Date.now(), learned = null) {
  const out = [];
  const S = series(data.wx); if (!S) return out;
  const E = series(data.east), W = series(data.west), So = series(data.south), M = series(data.marine);
  const daily = data.wx.daily || { time: [], sunrise: [], sunset: [] };
  const rises = daily.sunrise.map((x) => x * 1000), sets = daily.sunset.map((x) => x * 1000);
  const horizonEnd = now + 4 * 86400e3;
  const tideFactor = (key, t) => {
    const pref = condSettings(loc, key).tide; if (!pref || pref === 'any') return { m: 1, note: '' };
    const td = tideAt(M, t); if (!td) return { m: 1, note: '; tide unknown' };
    const m = 0.3 + 0.7 * tideMatch(pref, td.frac);
    return { m, note: `; ${tideWord(td.frac)} tide ${td.rising ? 'rising' : 'falling'} (${pref} wanted)` };
  };
  const push = (key, t, r, extra = {}) => {
    const st = condSettings(loc, key, learned);
    if (!st.on || t < now - HOUR || t > horizonEnd || !isFinite(r.score)) return;
    let score = r.score, why = r.why;
    if (key !== 'swell' && score > 0) { const tf = tideFactor(key, t); score = Math.round(score * tf.m); why += tf.note; }
    out.push({ key, locId: loc.id, loc: loc.name, t, score, why, alert: score >= st.min, min: st.min, ...extra });
  };

  for (let d = 0; d < rises.length; d++) {
    const sr = rises[d], ss = sets[d];
    // sunrise / sunset colour
    { const i = S.at(sr); if (i >= 0) push('sunrise', sr, glowScore(S, i, E, E ? E.at(sr) : -1)); }
    { const i = S.at(ss); if (i >= 0) push('sunset', ss, glowScore(S, i, W, W ? W.at(ss) : -1)); }

    // fog around dawn
    { let best = { f: 0 }, bt = sr;
      for (let k = -3; k <= 1; k++) { const i = S.at(sr + k * HOUR); if (i < 0) continue; const f = fogLikelihood(S, i); if (f.f > best.f) { best = f; bt = sr + k * HOUR; } }
      const hi = S.v('cloud_cover_high', S.at(sr)) ?? 0;
      const score = Math.round(100 * best.f * (1 - (hi / 100) * 0.2));
      push('fog', sr, { score, why: best.f > 0 ? `Visibility ${best.vis != null ? (best.vis >= 1000 ? (best.vis / 1000).toFixed(1) + ' km' : Math.round(best.vis) + ' m') : 'n/a'}, humidity ${pct(best.rh)}, wind ${Math.round(best.wind)} km/h around ${fmtTime(bt)}` : 'No fog signal' });
    }

    // swell (daylight)
    if (M) { const st = condSettings(loc, 'swell'); let best = null;
      for (let t = sr; t <= ss; t += HOUR) {
        const i = M.at(t); if (i < 0) continue;
        const h = M.v('swell_wave_height', i) ?? M.v('wave_height', i); const p = M.v('swell_wave_period', i) ?? M.v('wave_period', i) ?? 8;
        const dir = M.v('swell_wave_direction', i) ?? M.v('wave_direction', i);
        if (h == null) continue;
        const hf = h / st.height;
        let s = 0.6 * Math.pow(hf, 1.5) * (0.6 + 0.4 * clamp((p - 9) / 5));
        let dirF = 1;
        if (st.dir >= 0 && dir != null) { const diff = Math.abs(((dir - st.dir + 540) % 360) - 180); dirF = diff <= st.spread ? 1 : 0.2 + 0.8 * clamp(1 - (diff - st.spread) / 30); }
        const tf = tideFactor('swell', t);
        const golden = Math.min(Math.abs(t - sr), Math.abs(t - ss)) <= 1.5 * HOUR;
        if (golden && hf >= 0.9) s += 0.1;
        const g = S.v('wind_gusts_10m', S.at(t)) ?? 0; if (g >= 60) s += 0.08;
        s = clamp(s) * dirF * tf.m; // direction and tide scale the final score
        if (!best || s > best.s) best = { s, t, h, p, golden, g, dir, dirF, tide: tf.note };
      }
      if (best) push('swell', best.t, { score: Math.round(100 * clamp(best.s)), why: `Swell ${best.h.toFixed(1)} m @ ${Math.round(best.p)} s` + (best.dir != null ? ` from ${compassName(best.dir)}` : '') + ` around ${fmtTime(best.t)}` + (best.golden ? ' (golden hour)' : '') + (best.g >= 60 ? `, gusts ${Math.round(best.g)} km/h` : '') + (best.dirF < 1 ? `; wrong direction for this spot (wants ${compassName(st.dir)})` : '') + best.tide });
    }
  }

  // per local calendar day: storms, wind, snow, rainbow
  const byDay = {};
  S.t.forEach((t, i) => { if (t < now - HOUR || t > horizonEnd) return; (byDay[localParts(t).key] ||= []).push(i); });
  for (const idx of Object.values(byDay)) {
    let st = null, wd = null, rb = null, snow = 0, snowT = null;
    for (const i of idx) {
      const t = S.t[i], code = S.v('weather_code', i) ?? 0, cape = S.v('cape', i) ?? 0, pp = S.v('precipitation_probability', i) ?? 0, day = S.v('is_day', i);
      let s = code >= 95 ? (code >= 96 ? 0.85 : 0.75) : 0;
      s = Math.max(s, 0.8 * clamp((cape - 300) / 1700) * clamp(pp / 60));
      if (!day && s > 0) s *= 1.15;
      if (!st || s > st.s) st = { s, t, code, cape, pp, day };
      const g = S.v('wind_gusts_10m', i) ?? 0; if (!wd || g > wd.g) wd = { g, t };
      snow += S.v('snowfall', i) ?? 0; if ((S.v('snowfall', i) ?? 0) > 0 && !snowT) snowT = t;
      const sun = sunPos(t, loc.lat, loc.lon).alt, cc = S.v('cloud_cover', i) ?? 0;
      if (sun > 3 && sun < 40 && cc >= 25 && cc <= 80) {
        const shower = [80, 81, 82, 61, 51, 53].includes(code);
        const r = (shower ? 0.6 : 0) + 0.4 * clamp(1 - Math.abs(pp - 50) / 30) * (pp >= 25 ? 1 : 0);
        if (!rb || r > rb.r) rb = { r, t, pp, sun };
      }
    }
    if (st) push('storm', st.t, { score: Math.round(100 * clamp(st.s)), why: (st.code >= 95 ? 'Thunderstorm forecast' : `Instability CAPE ${Math.round(st.cape)} J/kg`) + ` around ${fmtTime(st.t)}, ${pct(st.pp)} rain chance` + (!st.day && st.s > 0 ? ', after dark (lightning)' : '') });
    if (wd) { const p = condSettings(loc, 'wind').gust; push('wind', wd.t, { score: wd.g >= p ? Math.round(clamp(0.55 + (wd.g - p) / 60) * 100) : Math.round(50 * wd.g / p), why: `Gusts to ${Math.round(wd.g)} km/h around ${fmtTime(wd.t)}` }); }
    { const p = condSettings(loc, 'snow').cm; const cm = snow; push('snow', snowT ?? S.t[idx[0]], { score: cm >= p ? Math.round(clamp(0.6 + (cm - p) * 0.05) * 100) : Math.round(50 * cm / p), why: cm > 0 ? `${cm.toFixed(1)} cm of snow forecast` : 'No snow forecast' }); }
    if (rb) push('rainbow', rb.t, { score: Math.round(100 * clamp(rb.r)), why: `Showers (${pct(rb.pp)}) with the sun ${Math.round(rb.sun)}° up around ${fmtTime(rb.t)}. Face away from the sun.` });
  }

  // nights: Milky Way + aurora
  for (let d = 0; d < sets.length - 1; d++) {
    const ss = sets[d], sr = rises[d + 1]; if (!sr) continue;
    const mwSt = condSettings(loc, 'milkyway'), auSt = condSettings(loc, 'aurora');
    let good = 0, core = 0, firstGood = null, coreT = null, clearSum = 0, hrs = 0;
    let au = null; const moon = moonPhase(ss + 6 * HOUR);
    for (let t = Math.ceil(ss / HOUR) * HOUR; t < sr; t += HOUR) {
      const i = S.at(t); if (i < 0) continue;
      const sun = sunPos(t, loc.lat, loc.lon).alt; if (sun > -12) continue;
      const cc = S.v('cloud_cover', i) ?? 100; const ccS = So ? (So.v('cloud_cover', So.at(t)) ?? cc) : cc;
      const mp = moonPos(t, loc.lat, loc.lon), mPh = moonPhase(t);
      const dark = sun < -18, moonOK = mp.alt < -1 || mPh.illum < 0.08;
      if (dark) { hrs++; clearSum += 1 - cc / 100; }
      if (dark && moonOK && cc <= mwSt.maxCloud) { good++; firstGood ??= t; const g = corePos(t, loc.lat, loc.lon).alt; if (g > 10) { core++; coreT ??= t; } }
      const k = kpAt(kp, t);
      if (k != null) { const sky = Math.min(1 - cc / 100, 1 - ccS / 100 * 0.9); const s = k >= auSt.kp ? clamp(0.45 + (k - auSt.kp) * 0.2) * (0.2 + 0.8 * sky) : 0.4 * (k / auSt.kp) ** 3 * sky; if (!au || s > au.s) au = { s, t, k, cc: ccS }; }
    }
    const mwS = clamp(good / 5) * 0.65 + clamp(core / 2) * 0.35;
    push('milkyway', firstGood ?? ss, { score: Math.round(100 * mwS), why: good ? `${good} h dark, moonless, ≤${mwSt.maxCloud}% cloud from ${fmtTime(firstGood)}` + (core ? `; core up from ${fmtTime(coreT)}` : '; core below horizon') + ` (${moonPhaseName(ss)}, ${pct(moon.illum * 100)} lit)` : `No clear moonless dark hours (${moonPhaseName(ss)}, ${pct(moon.illum * 100)} lit)` });
    if (au) push('aurora', au.t, { score: Math.round(100 * clamp(au.s)), why: `NOAA Kp ${au.k.toFixed(1)} forecast around ${fmtTime(au.t)}, ${pct(au.cc)} cloud to the south` });
  }

  // full moonrise near sunset / moonset near sunrise
  for (let d = 0; d < sets.length; d++) {
    const ss = sets[d], sr = rises[d];
    const tryEvent = (center, rising, Hz) => {
      let prev = moonPos(center - 75 * 60e3, loc.lat, loc.lon).alt;
      for (let t = center - 70 * 60e3; t <= center + 60 * 60e3; t += 5 * 60e3) {
        const a = moonPos(t, loc.lat, loc.lon).alt;
        if (rising ? prev < 0 && a >= 0 : prev > 0 && a <= 0) {
          const ph = moonPhase(t); if (ph.illum < 0.85) return;
          const j = Hz ? Hz.at(t) : -1; const low = j >= 0 ? (Hz.v('cloud_cover_low', j) ?? 0) : (S.v('cloud_cover_low', S.at(t)) ?? 0);
          const tot = S.v('cloud_cover', S.at(t)) ?? 0;
          const s = clamp((ph.illum - 0.8) / 0.15) * (1 - low / 100) * (1 - Math.max(0, tot - 50) / 100);
          push('moon', t, { score: Math.round(100 * clamp(s)), why: `${pct(ph.illum * 100)} lit moon ${rising ? 'rises' : 'sets'} at ${fmtTime(t)}, ${Math.round(Math.abs(t - center) / 60e3)} min ${t < center ? 'before' : 'after'} ${rising ? 'sunset' : 'sunrise'}; ${pct(low)} low cloud on that horizon` });
          return;
        }
        prev = a;
      }
    };
    if (ss) tryEvent(ss, true, E);
    if (sr) tryEvent(sr, false, W);
  }
  return out;
}

export async function runAll(config, { fetchImpl = fetch, now = Date.now(), onProgress, learned = null } = {}) {
  const kp = await fetchKp(fetchImpl);
  const results = [];
  for (const loc of config.locations.filter((l) => l.enabled !== false)) {
    const data = await fetchLocation(loc, fetchImpl, now);
    const events = evaluateLocation(loc, data, kp, now, learned);
    results.push({ loc, events, errors: data.errors, marinePoint: data.marine?.point, tides: tideExtremes(data.marine) });
    onProgress?.(results.length);
  }
  return { results, kp, now };
}

// Stable id for one condition at one spot on one local day (used by history and ratings).
export const eventId = (e) => `${e.locId}|${e.key}|${localParts(e.t).key}`;

// Alerts above threshold, grouped so one condition on one day across many spots is one item.
export function pickAlerts(run, { hours = 72, max = 8 } = {}) {
  const until = run.now + hours * HOUR;
  const all = run.results.flatMap((r) => r.events).filter((e) => e.alert && e.t >= run.now - HOUR && e.t <= until);
  const groups = {};
  for (const e of all.sort((a, b) => b.score - a.score)) {
    const g = (groups[`${e.key}|${localParts(e.t).key}`] ||= { ...e, also: [] });
    if (g !== e && g.locId !== e.locId) g.also.push(e);
  }
  return Object.values(groups).sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.t - b.t);
}

export function formatDigest(alerts, now) {
  if (!alerts.length) return null;
  return alerts.map((e) => {
    const also = e.also?.length ? `\nAlso: ${e.also.slice(0, 4).map((a) => `${a.loc} ${a.score}`).join(', ')}${e.also.length > 4 ? ` +${e.also.length - 4} more` : ''}` : '';
    return `${CONDITIONS[e.key].label.toUpperCase()} ${e.score}/100 · ${fmtWhen(e.t, now)}\n${e.loc}: ${e.why}${also}`;
  }).join('\n\n');
}
