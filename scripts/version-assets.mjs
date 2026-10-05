#!/usr/bin/env node
// version-assets.mjs — fingerprint the local stylesheets and scripts that built HTML pages load.
//
//   <link rel="stylesheet" href="site.css">   ->   href="site.css?v=3f9a1c07d2"
//   <script src="/ga-init.js"></script>       ->   src="/ga-init.js?v=8b21e0c4aa"
//
// The query is the first 10 hex characters of the file's SHA-256. The assets binding ignores it,
// but the Worker (site/src/headers.ts) sees `?v=<hash>` and serves those files as
// `Cache-Control: public, max-age=31536000, immutable`: repeat visits skip the network, and a
// deploy that changes a file changes its URL, so a new page never meets an old stylesheet.
//
// Runs last in scripts/build-site.sh, after every step that edits HTML or generates a script.
// Idempotent: an existing `?v=` is replaced. External URLs, data: URLs and files that do not
// exist in dist are left alone.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

const dist = resolve(process.argv[2] || 'site/dist');
const hashes = new Map();

function hashOf(file) {
  if (!hashes.has(file)) hashes.set(file, createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10));
  return hashes.get(file);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

function version(ref, pageDir) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return ref; // http:, data:, protocol-relative
  const [path] = ref.split(/[?#]/);
  if (!/\.(?:css|js)$/i.test(path)) return ref;
  const rel = path.startsWith('/') ? path.slice(1) : posix.join(pageDir, path);
  const file = resolve(dist, rel);
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) return ref;
  return `${path}?v=${hashOf(file)}`;
}

let refs = 0;
for (const page of walk(dist)) {
  const pageDir = relative(dist, dirname(page)).split(sep).join('/');
  const html = readFileSync(page, 'utf8')
    .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, (tag) =>
      tag.replace(/(\bhref=")([^"]+)(")/i, (_, a, ref, c) => `${a}${version(ref, pageDir)}${c}`)
    )
    .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/gi, (tag) =>
      tag.replace(/(\bsrc=")([^"]+)(")/i, (_, a, ref, c) => `${a}${version(ref, pageDir)}${c}`)
    );
  const before = readFileSync(page, 'utf8');
  if (html !== before) {
    writeFileSync(page, html);
    refs += (html.match(/\?v=[0-9a-f]{10}/g) || []).length;
  }
}
console.log(`version-assets: fingerprinted ${refs} stylesheet/script references`);
