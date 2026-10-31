// LOCAL DEVELOPMENT AND DEMO ONLY (Task 221, Handoff PRD §34 environment
// separation): the "Development build. Use synthetic data only." notice.
//
// The pages in public/ carry only an invisible placeholder where the notice
// goes:
//     <!-- qch:dev-notice class="footnote" -->
// Production (src/server.js) serves public/ as plain files, so it never
// shows the development wording. The synthetic dev server and the demo
// sign-in server, which both refuse to start unless NODE_ENV=development,
// replace the placeholder with the notice while serving the page. The
// decision is made on the server; the browser decides nothing.

import path from 'node:path';
import { readFile } from 'node:fs/promises';

export const DEV_NOTICE_TEXT = 'Development build. Use synthetic data only.';

const PLACEHOLDER = /<!-- qch:dev-notice(?: class="([a-z-]+)")? -->/g;
// Page paths only: "/", "/referral/", "/receiving/referral.html". Letters,
// digits, "_" and "-" only, so nothing outside public/ can be named.
const PAGE_PATH = /^\/(?:[A-Za-z0-9_-]+\/)*(?:[A-Za-z0-9_-]+\.html)?$/;

export function withDevNotice(html) {
  return html.replace(PLACEHOLDER, (_, className) => (
    `<p${className ? ` class="${className}"` : ''}>${DEV_NOTICE_TEXT}</p>`));
}

// Express middleware: serves a page that has a placeholder with the notice
// filled in. Everything else (pages without one, assets, the API) falls
// through unchanged.
export function devNoticePages({ publicDir }) {
  return async function devPages(req, res, next) {
    if (req.method !== 'GET' || !PAGE_PATH.test(req.path)) return next();
    let html;
    try {
      html = await readFile(path.join(publicDir, req.path.endsWith('/') ? `${req.path}index.html` : req.path), 'utf8');
    } catch {
      return next();
    }
    if (!html.includes('<!-- qch:dev-notice')) return next();
    res.set('Cache-Control', 'no-store');
    res.type('html').send(withDevNotice(html));
  };
}
