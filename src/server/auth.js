import { timingSafeEqual } from 'node:crypto';

// 403 ante Host u Origin ajenos (DNS rebinding, páginas web que llaman a localhost).
export function checkHostOrigin(req, port) {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowed.includes(req.headers.host)) return 403;
  const origin = req.headers.origin;
  if (origin !== undefined && !allowed.some((h) => origin === `http://${h}`)) return 403;
  return null;
}

export function bearer(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
