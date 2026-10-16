// Shoot Radar alert runner (GitHub Actions, Node 22+).
//   node alert.js                     -> decides mode from the cron that fired
//   MODE=digest|live node alert.js    -> force a mode (manual runs)
// Env: NTFY_TOPIC (required to send), NTFY_SERVER (default https://ntfy.sh),
//      SCHEDULE (github.event.schedule), EVENT (github.event_name), DRY_RUN=1 to print only,
//      LISTEN_SECONDS (lightning listen window, default 90).
// Files: config.json (app writes), ratings.json (app writes), history.json (digest writes), state.json (live writes).
import { readFile, writeFile } from 'node:fs/promises';
import * as E from './engine.js';

const now = Date.now();
const file = (n) => new URL(`./${n}`, import.meta.url);
async function readJSON(n, d) { try { return JSON.parse(await readFile(file(n), 'utf8')); } catch { return d; } }
const writeJSON = (n, v) => writeFile(file(n), JSON.stringify(v, null, 2) + '\n');

const cfg = await readJSON('config.json', { locations: [] });
const settings = { morning: true, evening: true, hours: 72, maxItems: 8, quietDigest: false, liveAurora: true, liveLightning: true, autoTune: true, ...cfg.settings };

const schedule = process.env.SCHEDULE || '';
const manual = process.env.EVENT && process.env.EVENT !== 'schedule';
const offset = E.utcOffsetHours(now); // 11 in AEDT, 10 in AEST

// Each digest has one cron per daylight-saving state; only the one matching today's offset runs.
const CRONS = {
  '45 19 * * *': { slot: 'morning', offset: 11 }, '45 20 * * *': { slot: 'morning', offset: 10 },
  '45 7 * * *': { slot: 'evening', offset: 11 },  '45 8 * * *': { slot: 'evening', offset: 10 },
};
const mode = process.env.MODE || (schedule.includes('*/') ? 'live' : 'digest');
let slot = E.localParts(now).h < 12 ? 'morning' : 'evening';
if (!manual && mode === 'digest') {
  const c = CRONS[schedule];
  if (!c) { console.log('Unknown schedule', schedule); process.exit(0); }
  if (c.offset !== offset) { console.log(`Skipping: ${schedule} is for UTC+${c.offset}, today is UTC+${offset}`); process.exit(0); }
  slot = c.slot;
  if (!settings[slot]) { console.log(`${slot} digest disabled in settings`); process.exit(0); }
}

async function send({ title, body, tags = 'camera', priority = 3, attach = null }) {
  console.log(`\n=== ${title} ===\n${body}\n`);
  const topic = process.env.NTFY_TOPIC;
  if (!topic || process.env.DRY_RUN) { console.log(topic ? '(dry run, not sent)' : 'NTFY_TOPIC not set, not sent'); return; }
  const server = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
  const headers = { Title: title, Tags: tags, Priority: String(priority) };
  if (cfg.appUrl) headers.Click = cfg.appUrl;
  if (attach) headers.Attach = attach;
  const r = await fetch(`${server}/${encodeURIComponent(topic)}`, { method: 'POST', body, headers });
  console.log('ntfy:', r.status);
  if (!r.ok) process.exitCode = 1;
}

// Location photo shown in the notification.
function photoUrl(loc) {
  if (!loc?.image) return null;
  if (/^https?:/.test(loc.image)) return loc.image;
  const repo = process.env.GITHUB_REPOSITORY, branch = process.env.GITHUB_REF_NAME || 'main';
  return repo ? `https://raw.githubusercontent.com/${repo}/${branch}/${loc.image}` : null;
}

// ------------------------------------------------------------------ morning / evening digest
if (mode === 'digest') {
  const ratings = (await readJSON('ratings.json', {})).ratings || {};
  const learned = settings.autoTune ? E.learnThresholds(ratings, cfg) : null;
  if (learned) for (const [k, v] of Object.entries(learned)) if (v.min != null && v.min !== v.base) console.log(`learned threshold ${k}: ${v.base} -> ${v.min} (${v.n} ratings)`);
  const run = await E.runAll(cfg, { now, learned });
  for (const r of run.results) if (r.errors.length) console.log(`! ${r.loc.name}: ${r.errors.join('; ')}`);
  const alerts = E.pickAlerts(run, { hours: settings.hours, max: settings.maxItems });
  const label = slot === 'morning' ? 'Morning outlook' : 'Evening outlook';
  if (alerts.length) {
    const top = alerts.reduce((a, b) => (b.score > a.score ? b : a));
    await send({
      title: `${label}: ${alerts.length} shoot${alerts.length > 1 ? 's' : ''} worth planning`,
      body: E.formatDigest(alerts, now),
      tags: { sunrise: 'sunrise', sunset: 'city_sunset', fog: 'fog', swell: 'ocean', storm: 'zap', milkyway: 'milky_way', aurora: 'star2', wind: 'dash', rainbow: 'rainbow', moon: 'full_moon', snow: 'snowflake' }[top.key] + ',camera',
      priority: top.score >= 85 ? 4 : 3,
      attach: photoUrl(cfg.locations.find((l) => l.id === top.locId)),
    });
  } else if (settings.quietDigest) {
    await send({ title: `${label}: nothing standout`, body: `No conditions above your thresholds in the next ${settings.hours} h.`, tags: 'zzz', priority: 2 });
  } else console.log('No alerts above thresholds.');

  // Log every alerted spot so you can rate it in the app afterwards.
  const history = await readJSON('history.json', { entries: [] });
  const byId = new Map((history.entries || []).map((h) => [h.id, h]));
  for (const a of alerts) for (const e of [a, ...a.also]) {
    const id = E.eventId(e), prev = byId.get(id);
    byId.set(id, { id, t: e.t, key: e.key, locId: e.locId, loc: e.loc, score: e.score, why: e.why, sent: prev?.sent ?? now });
  }
  history.entries = [...byId.values()].filter((h) => now - h.t < 120 * 86400e3).sort((a, b) => b.t - a.t).slice(0, 500);
  // Keep scheduled workflows alive (GitHub pauses them after 60 days without repo activity).
  if (!history.keepalive || now - history.keepalive > 30 * 86400e3) history.keepalive = now;
  await writeJSON('history.json', history);
}

// ------------------------------------------------------------------ live checks (every 15 min)
if (mode === 'live') {
  const state = await readJSON('state.json', {});

  // Aurora
  const auroraLocs = cfg.locations.filter((l) => l.enabled !== false && l.conditions?.aurora?.on);
  if (settings.liveAurora && auroraLocs.some((l) => E.sunPos(now, l.lat, l.lon).alt < -12)) {
    let est = null, bz = null;
    try {
      const kp = await (await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json')).json();
      const last = kp.slice().sort((a, b) => Date.parse(b.time_tag) - Date.parse(a.time_tag))[0];
      est = parseFloat(last.estimated_kp ?? last.kp_index); if (!isFinite(est)) est = null;
    } catch (e) { console.log('kp fetch failed', e.message); }
    try {
      const mag = await (await fetch('https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json')).json();
      const recent = mag.filter((m) => m.bz_gsm != null && now - Date.parse(m.time_tag + (m.time_tag.endsWith('Z') ? '' : 'Z')) < 30 * 60e3);
      if (recent.length) bz = recent.reduce((s, m) => s + m.bz_gsm, 0) / recent.length;
    } catch (e) { console.log('bz fetch failed', e.message); }
    console.log(`Aurora: est Kp ${est}, 30-min mean Bz ${bz?.toFixed(1)}`);
    const minKp = Math.min(...auroraLocs.map((l) => E.condSettings(l, 'aurora').kp), 9);
    const strongBz = bz != null && bz <= -10 && est != null && est >= minKp - 1;
    const recentlySent = state.lastAurora && now - state.lastAurora < 3 * 3600e3;
    if (est != null && (est >= minKp || strongBz) && !recentlySent) {
      const dark = auroraLocs.filter((l) => E.sunPos(now, l.lat, l.lon).alt < -12);
      await send({
        title: `Aurora alert: Kp ${est.toFixed(1)} right now`,
        body: `Estimated Kp ${est.toFixed(1)}${bz != null ? `, Bz ${bz.toFixed(1)} nT (${bz < 0 ? 'southward, good' : 'northward'})` : ''}. ${E.moonPhaseName(now)}.\nFace south from: ${dark.map((l) => l.name).join(', ')}.\nShoot long exposures; the camera sees it before your eyes do.`,
        tags: 'star2,rotating_light', priority: 5, attach: photoUrl(dark[0]),
      });
      state.lastAurora = now;
    }
  }

  // Lightning
  const boltLocs = cfg.locations.filter((l) => l.enabled !== false && l.conditions?.lightning?.on)
    .map((l) => ({ l, st: E.condSettings(l, 'lightning') }));
  if (settings.liveLightning && boltLocs.length) {
    const { listenForStrikes } = await import('./lightning.js');
    const maxR = Math.max(...boltLocs.map((b) => b.st.radius));
    const near = (s) => boltLocs.some((b) => E.distanceKm(b.l, s) <= maxR);
    const secs = +(process.env.LISTEN_SECONDS || 90);
    const res = await listenForStrikes(secs * 1000, near, process.env.BLITZ_HOSTS ? process.env.BLITZ_HOSTS.split(',') : undefined);
    if (!res) console.log('Lightning: could not connect to any Blitzortung server.');
    else {
      console.log(`Lightning: ${res.total} strikes worldwide in ${secs}s via ${res.host}, ${res.strikes.length} within ${maxR} km of a spot`);
      state.lastLightning ||= {};
      const hits = [];
      for (const { l, st } of boltLocs) {
        const mine = res.strikes.map((s) => ({ ...s, d: E.distanceKm(l, s) })).filter((s) => s.d <= st.radius);
        if (mine.length < st.strikes) continue;
        if (state.lastLightning[l.id] && now - state.lastLightning[l.id] < 90 * 60e3) { console.log(`Lightning near ${l.name} (already alerted)`); continue; }
        const nearest = mine.reduce((a, b) => (b.d < a.d ? b : a));
        // centroid of the activity, so the bearing describes the cell not one stray strike
        const c = { lat: mine.reduce((s, x) => s + x.lat, 0) / mine.length, lon: mine.reduce((s, x) => s + x.lon, 0) / mine.length };
        hits.push({ l, n: mine.length, nearest: nearest.d, dir: E.compassName(E.bearing(l, c)), dist: E.distanceKm(l, c) });
        state.lastLightning[l.id] = now;
      }
      if (hits.length) {
        hits.sort((a, b) => a.nearest - b.nearest);
        const dark = E.sunPos(now, hits[0].l.lat, hits[0].l.lon).alt < -6;
        await send({
          title: `Lightning ${Math.round(hits[0].nearest)} km from ${hits[0].l.name}`,
          body: hits.map((h) => `${h.l.name}: ${h.n} strikes in ${secs} s, activity ~${Math.round(h.dist)} km ${h.dir} (nearest ${Math.round(h.nearest)} km)`).join('\n')
            + `\n${dark ? 'After dark: long exposures, 10–30 s, f/8, ISO 100–400.' : 'Daylight: try a lightning trigger or fast burst.'} Stay well back from the cell; if you can hear thunder you are in range.`,
          tags: 'zap,rotating_light', priority: 4, attach: photoUrl(hits[0].l),
        });
      }
    }
  }
  await writeJSON('state.json', state);
}
