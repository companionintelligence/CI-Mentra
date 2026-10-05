#!/usr/bin/env node
// inject-crosslinks.mjs — wrap the hosted companion-UI demo (site/dist/app/index.html) in links
// back to the Companion Intelligence site, the docs, Buy Companion Core and Download Companion.
//
// /app/ is public/index.html copied verbatim — it is the exact UI the bridge serves, so the
// source file must not carry demo-only chrome. This step adds it to the built copy only:
//
//   * a slim "Demo: canned answers, nothing is saved" strip with a link back to the setup guide
//   * a footer with ci.computer, Docs, Buy Companion Core, Download Companion and the privacy policy
//   * "Sign out" (which on the demo only bounces to /) becomes a plain link back to the setup guide
//   * a preload for the canon tokens, so they load beside styles.css instead of behind its @import
//
// CSP-clean (no inline script or style): the CSS is /demo-bar.css. Idempotent: every block sits
// between marker comments and is removed before it is re-inserted. Fails the build if the page
// no longer has the markup it rewrites, so the demo cannot silently lose its links.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LINKS = {
  home: 'https://ci.computer',
  buy: 'https://ci.computer/core',
  download: 'https://ci.computer/download',
  docs: 'https://docs.ci.computer/docs/apps-available/first-party-apps/mentra-live',
  privacy: 'https://ci.computer/privacy-policy',
};

const MARKS = ['head', 'top', 'foot'];
const marker = (name, edge) => `<!-- crosslinks:${name}:${edge} -->`;
const wrap = (name, body) => `${marker(name, 'begin')}\n${body}\n${marker(name, 'end')}\n`;

const HEAD = `<link rel="preload" href="brand/tokens/tokens.css" as="style">
<link rel="stylesheet" href="/demo-bar.css">`;

const TOP = `<aside class="demo-bar" aria-label="About this demo">
  <p class="demo-bar__msg"><strong>Demo · developer preview</strong>Canned answers, nothing is saved.</p>
  <a href="/"><span aria-hidden="true">←</span> Setup guide</a>
</aside>`;

const FOOT = `<footer class="demo-foot">
  <nav class="demo-foot__nav" aria-label="Companion Intelligence">
    <a class="demo-foot__cta" href="${LINKS.buy}">Buy Companion Core</a>
    <a class="demo-foot__cta" href="${LINKS.download}">Download Companion</a>
    <a href="${LINKS.home}">Companion Intelligence</a>
    <a href="${LINKS.docs}">Docs</a>
    <a href="${LINKS.privacy}">Privacy policy</a>
  </nav>
  <p class="demo-foot__ga" data-ga-notice hidden>This site uses Google Analytics.</p>
</footer>`;

const SIGN_OUT = '<a class="btn btn--danger btn--wide" data-ring id="signout" href="/api/auth/logout">Sign out</a>';
const LEAVE = '<a class="btn btn--ghost btn--wide" data-ring id="signout" href="/">Back to setup guide</a>';

function injectCrosslinks(html) {
  let out = html;
  for (const name of MARKS) {
    out = out.replace(new RegExp(`${marker(name, 'begin')}[\\s\\S]*?${marker(name, 'end')}\\n?`, 'g'), '');
  }
  if (out.includes(SIGN_OUT)) out = out.replace(SIGN_OUT, LEAVE);
  else if (!out.includes(LEAVE)) throw new Error('inject-crosslinks: the Sign out link in app/index.html changed; update scripts/inject-crosslinks.mjs');

  const body = /<body[^>]*>\n?/.exec(out);
  if (!body || !out.includes('</head>') || !out.includes('</body>')) {
    throw new Error('inject-crosslinks: app/index.html has no <head>/<body>');
  }
  out = out.replace('</head>', `${wrap('head', HEAD)}</head>`);
  out = out.replace(body[0], `${body[0]}${wrap('top', TOP)}`);
  out = out.replace('</body>', `${wrap('foot', FOOT)}</body>`);
  return out;
}

const dist = resolve(process.argv[2] || 'site/dist');
const file = join(dist, 'app', 'index.html');
writeFileSync(file, injectCrosslinks(readFileSync(file, 'utf8')));
console.log('inject-crosslinks: demo bar, footer and sign-out link added to app/index.html');
