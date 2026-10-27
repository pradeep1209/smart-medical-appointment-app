/** Accept loopback aliases only for the configured development protocol and port. */
export function isTrustedWebOrigin(
  origin: string | undefined,
  configured = process.env.WEB_ORIGIN,
  environment = process.env.NODE_ENV,
): boolean {
  if (!origin || !configured) return false;
  try {
    const incoming = new URL(origin);
    const expected = new URL(configured);
    if (!['http:', 'https:'].includes(expected.protocol) || expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash) return false;
    // A browser Origin is a serialized origin, not a URL with credentials, a path or a fragment.
    if (incoming.origin !== origin) return false;
    if (incoming.origin === expected.origin) return true;
    if (environment !== 'development') return false;
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
    return loopback.has(incoming.hostname) && loopback.has(expected.hostname)
      && incoming.protocol === expected.protocol && incoming.port === expected.port;
  } catch { return false; }
}
