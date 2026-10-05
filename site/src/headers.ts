/**
 * Security, indexing and caching headers for every response from mentra.ci.computer.
 * Kept out of worker.ts because a Worker entry module may only export handlers.
 */

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Scripts: our own files, Google Analytics 4 (gtag.js) and the Cloudflare Web Analytics
  // beacon that Cloudflare injects into every HTML response. No inline script is allowed:
  // the GA bootstrap lives in /ga-init.js (scripts/inject-ga.mjs).
  "script-src 'self' https://www.googletagmanager.com https://static.cloudflareinsights.com",
  // No inline <style> or style="" anywhere on the site, so no 'unsafe-inline'.
  "style-src 'self'",
  "img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com https://*.googletagmanager.com",
  // Deliberately wide: the setup page's "Check your bridge" probe reads /health from a bridge
  // URL the visitor types in, which may be plain http (localhost, a tailnet name). GA4 collect
  // requests and the Cloudflare beacon also go through here.
  "connect-src 'self' http: https:",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** Not pages: keep them out of search results. /app/ itself stays indexable and fetches /api/ to render. */
const NOINDEX_PREFIXES = ['/api/', '/brand/', '/app/brand/'];
const NOINDEX_PATHS = new Set(['/healthz']);

export function isNoindexPath(pathname: string): boolean {
  return NOINDEX_PATHS.has(pathname) || NOINDEX_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Fingerprinted by scripts/version-assets.mjs as `?v=<content hash>`, so the URL changes with the file. */
const VERSION_PARAM = /^[0-9a-f]{8,64}$/;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|svg|ico)$/i;

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const IMAGE_CACHE = 'public, max-age=86400';

/**
 * The assets binding answers everything with `max-age=0, must-revalidate`. Loosen that only where it is safe:
 * fingerprinted CSS/JS can be cached forever, and icons/images for a day. HTML, sitemap.xml, robots.txt and
 * the manifest keep revalidating so a deploy shows up straight away.
 */
export function cacheControlFor(url: URL, response: Response): string | null {
  if (response.status !== 200) return null;
  if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) return null;
  const type = response.headers.get('content-type') || '';
  if (type.startsWith('text/html')) return null;
  const version = url.searchParams.get('v');
  if (version && VERSION_PARAM.test(version) && /\.(?:css|js)$/i.test(url.pathname)) return IMMUTABLE_CACHE;
  if (IMAGE_EXT.test(url.pathname)) return IMAGE_CACHE;
  return null;
}

export function withSecurityHeaders(response: Response, url?: URL): Response {
  const out = new Response(response.body, response);
  out.headers.set('content-security-policy', CONTENT_SECURITY_POLICY);
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  out.headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
  out.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  if (url) {
    if (isNoindexPath(url.pathname)) out.headers.set('x-robots-tag', 'noindex, nofollow');
    const cache = cacheControlFor(url, out);
    if (cache) out.headers.set('cache-control', cache);
  }
  return out;
}
