// Signed Telegram deep-link payloads: t.me/<bot>?start=<payload>.
// Payload = <uuid without dashes>_<16 hex HMAC>, 49 chars ≤ Telegram's 64 limit,
// and only [A-Za-z0-9_] as Telegram requires. Prevents binding someone else's
// profile to your chat (which would leak their name and streak to you).
import { createHmac, timingSafeEqual } from 'node:crypto';

const mac = (id, secret) => createHmac('sha256', secret).update(id).digest('hex').slice(0, 16);

export function signStart(userId, secret) {
  const compact = userId.replace(/-/g, '');
  return `${compact}_${mac(compact, secret)}`;
}

export function verifyStart(payload, secret) {
  const m = /^([0-9a-f]{32})_([0-9a-f]{16})$/.exec(payload || '');
  if (!m) return null;
  const want = Buffer.from(mac(m[1], secret)), got = Buffer.from(m[2]);
  if (!timingSafeEqual(want, got)) return null;
  const h = m[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
