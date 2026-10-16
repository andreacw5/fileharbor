/**
 * Share tokens grant read access to a private image or album: keep them out of
 * the request log line (the exception filter logs the route pattern, not the URL). They travel as `?token=` on GET /images/:id and as the last
 * path segment of GET /albums/shared/:token.
 */
export function sanitizeLoggedUrl(url: string): string {
  const [path, query] = url.split('?');
  const safePath = path.replace(/\/shared\/[^/]+/, '/shared/[REDACTED]');
  if (!query) return safePath;

  const params = new URLSearchParams(query);
  if (params.has('token')) params.set('token', '[REDACTED]');
  return `${safePath}?${params.toString()}`;
}
