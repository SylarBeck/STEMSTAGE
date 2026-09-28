// Who may use the game's local API (/api/*): the game page itself and programs on this PC.
//
// Checking the peer address (isLocal) is not enough on its own: a web page open in any browser on this PC connects
// from 127.0.0.1 too. So a request is only let in when
//   - its Host names this machine (a DNS-rebinding page arrives with its own host name), and
//   - it isn't a browser request from another site: its Origin, when there is one, is a loopback or desktop-app
//     origin; without one (a navigation, an <img> tag), Sec-Fetch-Site isn't "cross-site".
// Programs that aren't browsers (the desktop launcher, curl) send neither header and are let in.
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;
const APP_ORIGIN = /^(https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/i;

export const isAppOrigin = (origin) => APP_ORIGIN.test(origin || '');

/** '' when the request may use the local API, otherwise why not. */
export function refusal(req) {
  if (!LOOPBACK_HOST.test(req.headers.host || '')) return 'unexpected Host';
  const origin = req.headers.origin;
  if (origin !== undefined) return isAppOrigin(origin) ? '' : 'cross-site request';
  // no Origin: a navigation or an <img>/<script> tag, which says where it came from here
  return req.headers['sec-fetch-site'] === 'cross-site' ? 'cross-site request' : '';
}

/** Wrap a connect-style handler (Vite middleware or server/app.js service) with the check. */
export const guarded = (handler) => (req, res, next) => {
  const why = refusal(req);
  if (!why) return handler(req, res, next);
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: `local API: ${why}` }));
};
