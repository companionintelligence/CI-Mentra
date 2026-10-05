#!/usr/bin/env node
// inject-seo.mjs — canonical, description, Open Graph/Twitter cards and JSON-LD for every
// built HTML page in site/dist, plus /sitemap.xml and /robots.txt.
//
// Idempotent: the generated block is wrapped in <!-- seo:begin --> / <!-- seo:end --> and any
// previous block (and any stray description/canonical) is removed before re-insertion.
// JSON-LD is a data block, not executable script, so the `script-src 'self'` CSP does not
// affect it and no CSP change is needed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ORIGIN = 'https://mentra.ci.computer';
const SITE_NAME = 'Companion Intelligence';
const dist = resolve(process.argv[2] || 'site/dist');
const root = resolve(dist, '..', '..');
const OG_IMAGE = `${ORIGIN}/og.png`;

const ORG = { '@type': 'Organization', name: SITE_NAME, url: 'https://ci.computer' };

// file (relative to dist) -> page metadata. `src` is the repo file used for lastmod.
// /app/ keeps its trailing slash: the Worker uses html_handling "auto-trailing-slash",
// so /app 308-redirects to /app/ and the slash form is the real, canonical URL.
const PAGES = [
  {
    file: 'index.html',
    path: '/',
    src: 'site/public/index.html',
    title: 'Companion for Mentra',
    description:
      'Set up Companion Intelligence on Mentra smart glasses: run the CI-Mentra bridge, connect it to your Companion Hub and CI-Server memory, and try the companion UI.',
    app: true,
  },
  {
    file: 'app/index.html',
    path: '/app/',
    src: 'public/index.html',
    title: 'Companion demo for Mentra',
    description:
      'Try the Companion UI for Mentra in your browser. A voice-first assistant with memory, running against a canned demo with no account and nothing stored.',
    app: true,
  },
  {
    file: '404.html',
    path: null, // not indexable: no canonical, no sitemap entry
    title: 'Not found · Companion for Mentra',
    description: 'This page does not exist. Head back to the Companion for Mentra setup guide.',
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

function lastmod(src) {
  if (!src) return null;
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', src], { cwd: root, encoding: 'utf8' }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

function block(p) {
  const url = p.path === null ? null : ORIGIN + p.path;
  const lines = [
    '<!-- seo:begin -->',
    `<meta name="description" content="${esc(p.description)}">`,
    ...(url ? [`<link rel="canonical" href="${url}">`] : ['<meta name="robots" content="noindex">']),
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    ...(url ? [`<meta property="og:url" content="${url}">`] : []),
    `<meta property="og:image" content="${OG_IMAGE}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="Companion for Mentra: your companion, in your glasses.">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(p.title)}">`,
    `<meta name="twitter:description" content="${esc(p.description)}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
  ];
  if (url) {
    lines.push(`<script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', ...ORG })}</script>`);
    if (p.app) {
      lines.push(
        `<script type="application/ld+json">${jsonLd({
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'Companion for Mentra',
          description: p.description,
          url,
          publisher: ORG,
        })}</script>`
      );
    }
  }
  lines.push('<!-- seo:end -->');
  return lines.join('\n') + '\n';
}

const entries = [];
for (const p of PAGES) {
  const f = join(dist, p.file);
  if (!existsSync(f)) {
    console.error(`inject-seo: missing ${p.file}`);
    process.exit(1);
  }
  let html = readFileSync(f, 'utf8');
  html = html
    .replace(/<!-- seo:begin -->[\s\S]*?<!-- seo:end -->\n?/g, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');
  if (!html.includes('</head>')) {
    console.error(`inject-seo: no </head> in ${p.file}`);
    process.exit(1);
  }
  writeFileSync(f, html.replace('</head>', `${block(p)}</head>`));
  if (p.path !== null) entries.push({ loc: ORIGIN + p.path, lastmod: lastmod(p.src) });
}

writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map((e) => `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`)
      .join('\n') +
    `\n</urlset>\n`
);
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
console.log(`inject-seo: ${PAGES.length} pages, ${entries.length} in sitemap`);
