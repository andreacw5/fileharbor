/**
 * Content-Disposition for a user-supplied filename (RFC 6266): an ASCII
 * `filename` with quotes, backslashes and non-printables replaced, plus the
 * exact name as RFC 5987 `filename*` for clients that read it.
 */
export function contentDisposition(
  filename: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
