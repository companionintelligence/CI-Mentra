/**
 * Security headers for every response from mentra.ci.computer. Kept out of
 * worker.ts because a Worker entry module may only export handlers.
 */
/** Only the bridge health probe on the setup page talks to another origin. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' http: https:",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export function withSecurityHeaders(response: Response): Response {
  const out = new Response(response.body, response);
  out.headers.set('content-security-policy', CONTENT_SECURITY_POLICY);
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  out.headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
  out.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return out;
}
