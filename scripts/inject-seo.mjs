#!/usr/bin/env node
// inject-seo.mjs — <title>, canonical, description, icons, Open Graph/Twitter cards and JSON-LD
// for every built HTML page in site/dist, plus /sitemap.xml and /robots.txt.
//
// Idempotent: the generated block is wrapped in <!-- seo:begin --> / <!-- seo:end --> and any
// previous block (and any stray description/canonical/icon link) is removed before re-insertion;
// the <title> is replaced in place. JSON-LD is a data block, not executable script, so the
// script-src CSP does not affect it and no CSP change is needed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ORIGIN = 'https://mentra.ci.computer';
const SITE_NAME = 'Companion Intelligence';
const dist = resolve(process.argv[2] || 'site/dist');
const root = resolve(dist, '..', '..');
const OG_IMAGE = `${ORIGIN}/og.png`;

const ORG = { '@type': 'Organization', '@id': 'https://ci.computer/#organization', name: SITE_NAME, url: 'https://ci.computer' };
const WEBSITE = { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, name: 'Companion for Mentra', url: `${ORIGIN}/`, publisher: { '@id': ORG['@id'] } };

// file (relative to dist) -> page metadata. `src` lists the repo paths the page is made of (its HTML,
// the CSS/JS it loads and the injectors that add visible content); the sitemap lastmod is the date of
// the newest commit that touched any of them.
// /app/ keeps its trailing slash: the Worker uses html_handling "auto-trailing-slash", so /app
// redirects to /app/ (a 307 today; the status is the platform's choice, not ours) and the slash
// form is the real, canonical URL.
const PAGES = [
  {
    file: 'index.html',
    path: '/',
    src: ['site/public/index.html', 'site/public/site.css', 'site/public/env-builder.js', 'site/public/setup.js', 'scripts/inject-seo.mjs'],
    title: 'Companion for Mentra: setup guide | Companion Intelligence',
    name: 'Companion for Mentra',
    // 160 characters or fewer, so search results do not truncate it (checked by the site tests).
    description:
      'Companion for Mentra is a developer preview: a voice companion with memory for Mentra Live glasses. See how it works, build its settings file and try the demo.',
  },
  {
    file: 'app/index.html',
    path: '/app/',
    src: ['public', 'site/public/demo-bar.css', 'scripts/inject-crosslinks.mjs', 'scripts/inject-seo.mjs'],
    title: 'Companion demo for Mentra | Companion Intelligence',
    name: 'Companion demo for Mentra',
    description:
      'Try the Companion UI for Mentra in your browser. A voice-first assistant with memory, running against a canned demo with no account and nothing stored.',
    manifest: true,
  },
  {
    file: '404.html',
    path: null, // not indexable: no canonical, no sitemap entry
    title: 'Not found · Companion for Mentra',
    description: 'This page does not exist. Head back to the Companion for Mentra setup guide.',
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// Date (YYYY-MM-DD) of the newest commit touching any of `srcs`; null when git has no answer.
// The deploy workflow checks out full history, so this is a real date and not the deploy date.
function lastmod(srcs) {
  if (!srcs || srcs.length === 0) return null;
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...srcs], { cwd: root, encoding: 'utf8' }).trim();
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
    // Fetchable icon files (crawlers, link unfurlers and iOS cannot use an inline data: icon).
    `<link rel="icon" href="/favicon.ico" sizes="32x32">`,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    ...(p.manifest ? [`<link rel="manifest" href="/site.webmanifest">`] : []),
  ];
  if (url) {
    // WebSite/WebPage, not SoftwareApplication: the docs say it is a developer preview that cannot
    // be installed yet, so the page must not claim an installable app (and carries no offers).
    lines.push(
      `<script type="application/ld+json">${jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          ORG,
          WEBSITE,
          {
            '@type': 'WebPage',
            '@id': `${url}#webpage`,
            name: p.name,
            description: p.description,
            url,
            isPartOf: { '@id': WEBSITE['@id'] },
            publisher: { '@id': ORG['@id'] },
          },
        ],
      })}</script>`
    );
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
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '')
    // The sources carry an inline data: icon (its SVG contains '>', so match the quoted href whole);
    // the block below replaces it with real files.
    .replace(/<link\s+rel="icon"\s+href="data:[^"]*"\s*\/?>\s*/gi, '')
    .replace(/<link\s+rel="(?:icon|apple-touch-icon|manifest)"[^>]*>\s*/gi, '');
  if (!html.includes('</head>') || !/<title>[\s\S]*?<\/title>/i.test(html)) {
    console.error(`inject-seo: no </head> or <title> in ${p.file}`);
    process.exit(1);
  }
  // The tab, search result and share card must say the same thing.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escText(p.title)}</title>`);
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
// /api/ is deliberately not disallowed: /app/ fetches it to render, and a crawler that cannot fetch
// it sees an error screen. Those responses (and /brand/) send `X-Robots-Tag: noindex` instead.
writeFileSync(
  join(dist, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /healthz\n\nSitemap: ${ORIGIN}/sitemap.xml\n`
);
console.log(`inject-seo: ${PAGES.length} pages, ${entries.length} in sitemap`);
