#!/usr/bin/env node
// inject-ga.mjs — add Google Analytics 4 (gtag.js) to every built HTML page in site/dist.
//
// The measurement ID comes from the build-time env var GA_MEASUREMENT_ID. If it is
// unset or not /^G-[A-Z0-9]+$/, nothing is emitted. The site CSP is `script-src 'self'`
// (+ googletagmanager.com), so the dataLayer/config bootstrap is written to /ga-init.js
// instead of an inline <script>.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GA_ID_RE = /^G-[A-Z0-9]+$/;
const dist = resolve(process.argv[2] || 'site/dist');
const id = (process.env.GA_MEASUREMENT_ID || '').trim();

if (!GA_ID_RE.test(id)) {
  console.log('GA_MEASUREMENT_ID unset or invalid; skipping Google Analytics');
  process.exit(0);
}

const tag =
  `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n` +
  `<script src="/ga-init.js"></script>\n`;

writeFileSync(
  join(dist, 'ga-init.js'),
  `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', '${id}');\n`
);

let count = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.html')) {
      const html = readFileSync(p, 'utf8');
      if (!html.includes('</head>') || html.includes('/ga-init.js')) continue;
      writeFileSync(p, html.replace('</head>', `${tag}</head>`));
      count++;
    }
  }
})(dist);
console.log(`injected GA4 into ${count} HTML files`);
