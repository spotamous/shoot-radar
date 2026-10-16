// Live lightning from the Blitzortung.org community network (free for private, non-commercial use).
// Opens the public websocket feed, listens for a short window and returns strikes {t, lat, lon}.
import WebSocket from 'ws';

const HOSTS = ['ws1', 'ws7', 'ws8', 'ws2', 'ws3', 'ws5'];

// Blitzortung frames are LZW-style compressed JSON strings.
export function decode(b) {
  const dict = {}, data = [...b];
  let c = data[0], prev = c; const out = [c]; let code = 256;
  for (let i = 1; i < data.length; i++) {
    const n = data[i].charCodeAt(0);
    const w = n < 256 ? data[i] : dict[n] ? dict[n] : prev + c;
    out.push(w); c = w.charAt(0); dict[code++] = prev + c; prev = w;
  }
  return out.join('');
}

export function parseFrame(text) {
  let j; try { j = JSON.parse(text); } catch { try { j = JSON.parse(decode(text)); } catch { return null; } }
  if (!j || !isFinite(j.lat) || !isFinite(j.lon)) return null;
  const t = j.time ? Math.round(Number(j.time) / 1e6) : Date.now(); // ns -> ms
  return { t, lat: +j.lat, lon: +j.lon };
}

function listenOn(url, ms, filter) {
  return new Promise((resolve, reject) => {
    const strikes = []; let opened = false, total = 0;
    const ws = new WebSocket(url, { headers: { Origin: 'https://map.blitzortung.org' }, handshakeTimeout: 10000 });
    const finish = () => { try { ws.terminate(); } catch {} resolve({ strikes, total, host: url }); };
    ws.on('open', () => { opened = true; ws.send('{"a":111}'); setTimeout(finish, ms); });
    ws.on('message', (buf) => { const s = parseFrame(buf.toString()); if (s) { total++; if (!filter || filter(s)) strikes.push(s); } });
    ws.on('error', (e) => (opened ? finish() : reject(e)));
    ws.on('close', () => (opened ? finish() : reject(new Error('closed before open'))));
  });
}

// Try each server until one connects. `filter` keeps only strikes you care about (memory).
export async function listenForStrikes(ms = 90000, filter, hosts = HOSTS.map((h) => `wss://${h}.blitzortung.org/`)) {
  for (const url of hosts) {
    try { return await listenOn(url, ms, filter); } catch (e) { console.log(`lightning: ${url} ${e.message}`); }
  }
  return null;
}
