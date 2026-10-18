// Web Push sender (RFC 8291 aes128gcm encryption + RFC 8292 VAPID), Node built-ins only.
// Delivers notifications straight to the Shoot Radar app installed on your iPhone's Home Screen.
import crypto from 'node:crypto';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64u = (s) => Buffer.from(String(s).replace(/=+$/, ''), 'base64url');

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const expand = (prk, info, len) => hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, len);

// Encrypt a payload for one subscription. `opts` lets tests inject the server key and salt.
export function encrypt(sub, payload, opts = {}) {
  const uaPublic = fromB64u(sub.keys.p256dh), auth = fromB64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.asPrivate) ecdh.setPrivateKey(fromB64u(opts.asPrivate)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ? fromB64u(opts.salt) : crypto.randomBytes(16);
  const ikm = expand(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = expand(prk, 'Content-Encoding: nonce\0', 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

// VAPID: the public key lives in config.json, the private part (`d`) in the VAPID_PRIVATE_KEY secret.
export function vapidKey(publicB64u, privateD) {
  const pub = fromB64u(publicB64u);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: String(privateD).trim(), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}
export function vapidJWT(endpoint, key, subject) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

// Send one notification. Returns {ok, status, gone} — gone=true means the device unsubscribed.
export async function sendPush(sub, message, { publicKey, privateKey, subject, urgency = 'normal', ttl = 6 * 3600 }) {
  const key = vapidKey(publicKey, privateKey);
  const body = encrypt(sub, JSON.stringify(message));
  const r = await fetch(sub.endpoint, {
    method: 'POST', body,
    headers: {
      TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${vapidJWT(sub.endpoint, key, subject)}, k=${publicKey}`,
      ...(message.tag ? { Topic: String(message.tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
    },
  });
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410, text: r.ok ? '' : await r.text().catch(() => '') };
}
