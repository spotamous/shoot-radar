// Shoot Radar alert runner (GitHub Actions, Node 20+).
//   node alert.js            -> decides mode from the cron that fired
//   MODE=digest|live node alert.js  -> force a mode (manual runs)
// Env: NTFY_TOPIC (required to send), NTFY_SERVER (default https://ntfy.sh),
//      SCHEDULE (github.event.schedule), EVENT (github.event_name), DRY_RUN=1 to print only.
import { readFile, writeFile } from 'node:fs/promises';
import * as E from './engine.js';

const now = Date.now();
const cfg = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const statePath = new URL('./state.json', import.meta.url);
let state = {}; try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch {}
const settings = { morning: true, evening: true, hours: 72, maxItems: 8, quietDigest: false, liveAurora: true, ...cfg.settings };

const schedule = process.env.SCHEDULE || '';
const manual = process.env.EVENT && process.env.EVENT !== 'schedule';
const offset = E.utcOffsetHours(now); // 11 in AEDT, 10 in AEST

// Each digest has one cron per daylight-saving state; only the one matching today's offset runs.
const CRONS = {
  '45 19 * * *': { slot: 'morning', offset: 11 }, '45 20 * * *': { slot: 'morning', offset: 10 },
  '45 7 * * *': { slot: 'evening', offset: 11 },  '45 8 * * *': { slot: 'evening', offset: 10 },
};
let mode = process.env.MODE || (schedule.includes('*/30') ? 'live' : 'digest');
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

// Location photo shown in the notification (top alert's spot).
function photoUrl(loc) {
  if (!loc?.image) return null;
  if (/^https?:/.test(loc.image)) return loc.image;
  const repo = process.env.GITHUB_REPOSITORY, branch = process.env.GITHUB_REF_NAME || 'main';
  return repo ? `https://raw.githubusercontent.com/${repo}/${branch}/${loc.image}` : null;
}

if (mode === 'digest') {
  const run = await E.runAll(cfg, { now });
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
  // Keep scheduled workflows alive (GitHub pauses them after 60 days without repo activity).
  if (!state.keepalive || now - state.keepalive > 30 * 86400e3) state.keepalive = now;
}

if (mode === 'live' && settings.liveAurora) {
  const locs = cfg.locations.filter((l) => l.enabled !== false && l.conditions?.aurora?.on);
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
  console.log(`Live: est Kp ${est}, 30-min mean Bz ${bz?.toFixed(1)}`);
  const minKp = Math.min(...locs.map((l) => E.condSettings(l, 'aurora').kp), 9);
  const strongBz = bz != null && bz <= -10 && est != null && est >= minKp - 1;
  const recentlySent = state.lastAurora && now - state.lastAurora < 3 * 3600e3;
  if (locs.length && est != null && (est >= minKp || strongBz) && !recentlySent) {
    const dark = locs.filter((l) => E.sunPos(now, l.lat, l.lon).alt < -12);
    if (dark.length) {
      const moon = E.moonPhaseName(now);
      await send({
        title: `Aurora alert: Kp ${est.toFixed(1)} right now`,
        body: `Estimated Kp ${est.toFixed(1)}${bz != null ? `, Bz ${bz.toFixed(1)} nT (${bz < 0 ? 'southward, good' : 'northward'})` : ''}. ${moon}.\nFace south from: ${dark.map((l) => l.name).join(', ')}.\nShoot long exposures; the camera sees it before your eyes do.`,
        tags: 'star2,rotating_light', priority: 5,
      });
      state.lastAurora = now;
    } else console.log('Kp high but no aurora locations are dark yet.');
  }
}

await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
