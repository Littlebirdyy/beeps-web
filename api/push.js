// Beeps Web Push sender — Vercel Node serverless function.
// POST { key, title, body, url } -> đẩy Web Push tới mọi subscription đã lưu.
//   key   = PUSH_SECRET (khớp biến môi trường, nếu sai -> 401).
//   title = tiêu đề notification (mặc định "Beeps").
//   body  = nội dung.
//   url   = link mở khi bấm (mặc định /app.html).
// Đọc subscriptions từ Apps Script: <SHEET_API>?subs=1&key=beeps26
// Biến môi trường Vercel: VAPID_PUBLIC, VAPID_PRIVATE, PUSH_SECRET, SHEET_API.

const webpush = require('web-push');

const SUBS_KEY = 'beeps26'; // key GET của Apps Script (khớp route ?subs=1&key=beeps26)

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') { try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); } }
      return resolve(req.body);
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
  }

  const VAPID_PUBLIC = process.env.VAPID_PUBLIC;
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
  const PUSH_SECRET = process.env.PUSH_SECRET;
  const SHEET_API = process.env.SHEET_API;

  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !PUSH_SECRET || !SHEET_API) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: 'server_not_configured' }));
  }

  const body = await readBody(req);
  const { key, title, url } = body;
  const bodyText = body.body;

  if (!key || key !== PUSH_SECRET) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
  }

  try {
    webpush.setVapidDetails('mailto:beeps@thebeeps.vercel.app', VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: 'bad_vapid', detail: String(e) }));
  }

  // Đọc subscriptions từ Apps Script
  let subs = [];
  try {
    const sep = SHEET_API.indexOf('?') >= 0 ? '&' : '?';
    const apiUrl = SHEET_API + sep + 'subs=1&key=' + encodeURIComponent(SUBS_KEY);
    const r = await fetch(apiUrl, { redirect: 'follow' });
    const j = await r.json();
    subs = (j && j.subs) || [];
  } catch (e) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: 'fetch_subs_failed', detail: String(e) }));
  }

  // onlyOwner: chỉ gửi tới máy OWNER (đã bật thông báo khi đăng nhập owner) — dùng cho noti "đơn mới"
  if (body.onlyOwner) {
    subs = (subs || []).filter(function (s) { return s && (s.owner === 1 || s.owner === true || s.owner === '1'); });
  }

  const payload = JSON.stringify({
    title: title || 'Beeps',
    body: bodyText || '',
    url: url || '/app.html'
  });

  let sent = 0, failed = 0, expired = 0;
  await Promise.all((subs || []).map(async (item) => {
    const sub = item && item.sub;
    if (!sub || !sub.endpoint) { failed++; return; }
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) { expired++; } // subscription hết hạn -> bỏ qua
      else { failed++; }
    }
  }));

  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, sent, failed, expired, total: subs.length }));
};
