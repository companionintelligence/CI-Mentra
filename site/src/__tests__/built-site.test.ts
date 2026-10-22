/**
 * Builds the site with scripts/build-site.sh and checks the OUTPUT: the cross-links back to
 * ci.computer, the metadata and the CSP-clean markup that the injectors are responsible for.
 * Runs the real build (about a second), so a change to any injector that drops a link, leaves
 * an inline script or duplicates a tag on rebuild fails here instead of in production.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const DIST = join(ROOT, 'site', 'dist');
const GA_ID = 'G-TEST1234';

const CI_HOME = 'https://ci.computer';
const BUY = 'https://ci.computer/core';
const DOWNLOAD = 'https://ci.computer/download';
const DOCS = 'https://docs.ci.computer/docs/apps-available/first-party-apps/mentra-live';

function build(env: Record<string, string> = {}): void {
  execFileSync('bash', [join(ROOT, 'scripts', 'build-site.sh')], {
    cwd: ROOT,
    env: { ...process.env, GA_MEASUREMENT_ID: GA_ID, ...env },
    stdio: 'pipe',
  });
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of listFiles(DIST)) out[f.slice(DIST.length)] = createHash('sha256').update(readFileSync(f)).digest('hex');
  return out;
}

const read = (rel: string): string => readFileSync(join(DIST, rel), 'utf8');
/** Date (YYYY-MM-DD) of the newest commit touching any of the repo paths, as the sitemap computes it. */
const gitDate = (...paths: string[]): string =>
  execFileSync('git', ['log', '-1', '--format=%cs', '--', ...paths], { cwd: ROOT, encoding: 'utf8' }).trim();
const hrefs = (html: string): string[] => [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
const meta = (html: string, attr: string, key: string): string | undefined =>
  new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(html)?.[1];

describe('built site', () => {
  let first: Record<string, string>;
  const pages = { '/': 'index.html', '/app/': 'app/index.html', '404': '404.html' };

  beforeAll(() => {
    build();
    first = snapshot();
  }, 60_000);

  describe.each(Object.entries(pages))('%s', (_path, file) => {
    it('links back to ci.computer, the docs, Buy Companion Core and Download Companion', () => {
      const links = hrefs(read(file));
      for (const url of [CI_HOME, BUY, DOWNLOAD, DOCS]) expect(links).toContain(url);
    });

    it('opens ci.computer links in the same tab', () => {
      const html = read(file);
      const tags = [...html.matchAll(/<a\b[^>]*\bhref="https:\/\/(?:ci\.computer|docs\.ci\.computer)[^"]*"[^>]*>/g)].map((m) => m[0]);
      expect(tags.length).toBeGreaterThanOrEqual(4);
      for (const tag of tags) expect(tag).not.toMatch(/target=/);
    });

    it('uses the same wording for the callouts everywhere', () => {
      const html = read(file);
      expect(html).toContain('>Buy Companion Core</a>');
      expect(html).toContain('>Download Companion</a>');
    });

    it('says the Buy and Download links are for the Companion platform, not the Mentra preview', () => {
      // The page also says Companion for Mentra cannot be installed yet, so a bare "Download
      // Companion" in the footer must not read as a way to get it.
      const html = read(file);
      const notes = [...html.matchAll(/class="(?:foot__note|demo-foot__note)">([^<]*)</g)].map((m) => m[1]);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain('Companion platform itself');
      expect(notes[0]).toContain('Companion for Mentra can’t be installed yet.');
      const noteAt = html.indexOf(notes[0]);
      const downloadAt = html.lastIndexOf('>Download Companion</a>');
      expect(Math.abs(noteAt - downloadAt)).toBeLessThan(600);
    });

    it('has no inline script or style, so the CSP can stay strict', () => {
      const html = read(file);
      const inlineScripts = [...html.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\bsrc=/.test(m[1]) && !/application\/ld\+json/.test(m[1]));
      expect(inlineScripts).toHaveLength(0);
      expect(html).not.toMatch(/<style[\s>]/);
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).not.toMatch(/\son(?:click|load|error)=/);
    });

    it('has a title that matches its social title, and a description of 160 characters or fewer', () => {
      const html = read(file);
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
      expect(title).toBeTruthy();
      expect(title!.length).toBeGreaterThan(9);
      expect(meta(html, 'property', 'og:title')).toBe(title);
      expect(meta(html, 'name', 'twitter:title')).toBe(title);
      const description = meta(html, 'name', 'description')!;
      expect(description.length).toBeGreaterThan(50);
      expect(description.length).toBeLessThanOrEqual(160);
      expect(html.match(/<title>/g)).toHaveLength(1);
      expect(html.match(/name="description"/g)).toHaveLength(1);
    });

    it('links fetchable icons and sets theme-color', () => {
      const html = read(file);
      expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32">');
      expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml">');
      expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
      expect(html).not.toContain('rel="icon" href="data:');
      expect(html).toContain('<meta name="theme-color" content="#041620">');
      expect(html).toContain('<html lang="en" class="dark">');
      for (const f of ['favicon.ico', 'icon.svg', 'apple-touch-icon.png']) expect(existsSync(join(DIST, f))).toBe(true);
    });

    it('injects GA4 once and reveals the analytics notice', () => {
      const html = read(file);
      expect(html.match(/googletagmanager\.com\/gtag\/js\?id=G-TEST1234/g)).toHaveLength(1);
      expect(html.match(/src="\/ga-init\.js\?v=[0-9a-f]{10}"/g)).toHaveLength(1);
      expect(html).toMatch(/data-ga-notice(?!\s+hidden)/);
      expect(html).not.toMatch(/data-ga-notice\s+hidden/);
    });

    it('fingerprints every local stylesheet and script that exists', () => {
      const html = read(file);
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
      const refs = [
        ...[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
        ...[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((m) => m[1]),
      ].filter((ref) => !/^https?:/.test(ref));
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref).toMatch(/\.(?:css|js)\?v=[0-9a-f]{10}$/);
        const path = ref.split('?')[0];
        expect(existsSync(join(DIST, path.startsWith('/') ? path.slice(1) : dir + path))).toBe(true);
      }
    });
  });

  it('adds the demo bar, footer and a way back to the setup guide to /app/ only', () => {
    const app = read('app/index.html');
    expect(app).toContain('class="demo-bar"');
    expect(app).toContain('Demo · developer preview');
    expect(app).toContain('Canned answers, nothing is saved.');
    expect(app).toContain('class="demo-foot"');
    expect(app).toContain('<link rel="stylesheet" href="/demo-bar.css?v=');
    expect(app).toContain('id="signout" href="/">Back to setup guide</a>');
    expect(app).not.toContain('href="/api/auth/logout"');
    expect(app.match(/crosslinks:top:begin/g)).toHaveLength(1);
    expect(app.match(/crosslinks:foot:begin/g)).toHaveLength(1);
    // The bridge serves public/index.html verbatim: the source must carry none of the demo chrome.
    const source = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
    expect(source).not.toContain('demo-bar');
    expect(source).toContain('href="/api/auth/logout"');
    expect(read('index.html')).not.toContain('demo-bar');
  });

  it('labels each tab panel by its tab button', () => {
    const app = read('app/index.html');
    for (const v of ['talk', 'memory', 'profile']) {
      expect(app).toContain(`id="tab-${v}"`);
      expect(app).toMatch(new RegExp(`id="view-${v}"[^>]*\\s+aria-labelledby="tab-${v}"`));
    }
  });

  it('has the footer legal links and Discord/support on the setup guide', () => {
    const links = hrefs(read('index.html'));
    for (const url of ['https://ci.computer/support', 'https://ci.computer/privacy-policy', 'https://ci.computer/terms-of-service', 'https://ci.computer/gg']) {
      expect(links).toContain(url);
    }
    expect(read('index.html')).not.toContain('href="/healthz"');
  });

  it('puts ci.computer on the header logo of the setup guide and the 404 page', () => {
    for (const file of ['index.html', '404.html']) {
      const header = /<header class="top">[\s\S]*?<\/header>/.exec(read(file))![0];
      expect(header).toMatch(/<a class="brand" href="https:\/\/ci\.computer"/);
      expect(header).toContain(`href="${DOCS}"`);
    }
  });

  it('tells visitors it is a developer preview and does not overclaim privacy', () => {
    const html = read('index.html');
    expect(html).toContain('Developer preview');
    expect(html).toContain('You can’t install Companion for Mentra yet.');
    expect(html).not.toMatch(/stay on hardware you control/i);
    expect(html).toContain('audio and transcripts do travel through Mentra');
    expect(html).not.toContain('git clone https://github.com');
  });

  it('uses public product names in visible copy', () => {
    for (const file of ['index.html', '404.html', 'app/index.html']) {
      const text = read(file)
        .replace(/<(script|style|pre)\b[\s\S]*?<\/\1>/g, '')
        .replace(/<code>[\s\S]*?<\/code>/g, '')
        .replace(/<[^>]+>/g, ' ');
      expect(text).not.toMatch(/\bCI-(?:Mentra|Hub|Server|Portal|Import)/);
      expect(text).not.toContain('Device layer');
    }
  });

  it('writes JSON-LD that parses, with no installable-app claim', () => {
    for (const file of ['index.html', 'app/index.html']) {
      const blocks = [...read(file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      expect(blocks).toHaveLength(1);
      const types = blocks[0]['@graph'].map((n: { '@type': string }) => n['@type']);
      expect(types).toEqual(['Organization', 'WebSite', 'WebPage']);
      expect(JSON.stringify(blocks)).not.toMatch(/SoftwareApplication|offers|price/);
    }
    expect(read('404.html')).not.toContain('ld+json');
  });

  it('keeps 404 out of the index and canonical pages self-referencing', () => {
    expect(read('404.html')).toContain('<meta name="robots" content="noindex">');
    expect(read('index.html')).toContain('<link rel="canonical" href="https://mentra.ci.computer/">');
    expect(read('app/index.html')).toContain('<link rel="canonical" href="https://mentra.ci.computer/app/">');
  });

  it('lists the two indexable pages in the sitemap and keeps /api/ crawlable but noindex', () => {
    const sitemap = read('sitemap.xml');
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual(['https://mentra.ci.computer/', 'https://mentra.ci.computer/app/']);
    const robots = read('robots.txt');
    expect(robots).toContain('Sitemap: https://mentra.ci.computer/sitemap.xml');
    expect(robots).toContain('Disallow: /healthz');
    expect(robots).not.toMatch(/Disallow:\s*\/api/);
  });

  it('dates each sitemap entry from every file the page is made of, not just its HTML', () => {
    const lastmods = Object.fromEntries(
      [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]])
    );
    const home = lastmods['https://mentra.ci.computer/'];
    const app = lastmods['https://mentra.ci.computer/app/'];
    expect(home).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(app).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // ISO dates compare as strings. A change to only the CSS or JS of a page must move its lastmod.
    for (const f of ['index.html', 'site.css', 'env-builder.js', 'setup.js']) {
      expect(home >= gitDate(`site/public/${f}`)).toBe(true);
    }
    expect(home >= gitDate('scripts/inject-seo.mjs')).toBe(true);
    for (const p of ['public/index.html', 'public/app.js', 'public/styles.css', 'site/public/demo-bar.css', 'scripts/inject-crosslinks.mjs']) {
      expect(app >= gitDate(p)).toBe(true);
    }
  });

  it('ships a share image that is a 1200x630 PNG, as the og:image tags say', () => {
    const png = readFileSync(join(DIST, 'og.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    for (const file of Object.values(pages)) {
      const html = read(file);
      if (file === '404.html') continue;
      expect(meta(html, 'property', 'og:image')).toBe('https://mentra.ci.computer/og.png');
      expect(meta(html, 'property', 'og:image:width')).toBe('1200');
      expect(meta(html, 'property', 'og:image:height')).toBe('630');
    }
    // The PNG is committed, so the way to rebuild it must exist and be written down.
    expect(existsSync(join(ROOT, 'site', 'seo', 'og.svg'))).toBe(true);
    expect(existsSync(join(ROOT, 'scripts', 'make-og.sh'))).toBe(true);
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).toContain('scripts/make-og.sh');
  });

  it('README lists the same deploy triggers as the workflow', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-site.yml'), 'utf8');
    const paths = [...(/\n {4}paths:\n((?: {6}- '[^']+'\n)+)/.exec(workflow)?.[1] ?? '').matchAll(/- '([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(3);
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const sentence = /deploy-site\.yml`[^]*?on manual dispatch/.exec(readme)?.[0] ?? '';
    expect(sentence).not.toBe('');
    for (const p of paths.filter((x) => !x.startsWith('.github/'))) {
      const shown = p.replace(/\/\*\*$/, '/');
      expect(sentence).toContain(`\`${shown}\``);
    }
    expect(sentence).not.toContain('package.json');
  });

  it('ships a valid manifest whose icons exist', () => {
    const manifest = JSON.parse(read('site.webmanifest'));
    expect(manifest.start_url).toBe('/app/');
    expect(read('app/index.html')).toContain('<link rel="manifest" href="/site.webmanifest">');
    for (const icon of manifest.icons as { src: string }[]) expect(existsSync(join(DIST, icon.src.slice(1)))).toBe(true);
  });

  it('leaves no analytics behind and hides the notice when GA_MEASUREMENT_ID is unset', () => {
    build({ GA_MEASUREMENT_ID: '' });
    for (const file of Object.values(pages)) {
      const html = read(file);
      expect(html).not.toContain('googletagmanager.com');
      expect(html).not.toContain('ga-init.js');
      expect(html).toMatch(/data-ga-notice\s+hidden/);
    }
    build();
  }, 60_000);

  it('rebuilds to byte-identical output (no duplicated tags)', () => {
    build();
    expect(snapshot()).toEqual(first);
  }, 60_000);
});
