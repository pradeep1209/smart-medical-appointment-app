export function isPrivateIpv4(value: string) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || String(Number(p)) !== p || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
}

export function validateEnvironment(env: NodeJS.ProcessEnv) {
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'WEB_ORIGIN', 'WEB_PUBLIC_URL']) if (!env[key]) throw Error(`Missing ${key}. Check your local environment configuration.`);
  if (env.JWT_SECRET!.length < 48 || /REPLACE|CHANGE_ME/i.test(env.JWT_SECRET!)) throw Error('JWT_SECRET must be a generated secret of at least 48 characters.');
  const origin = new URL(env.WEB_ORIGIN!), publicUrl = new URL(env.WEB_PUBLIC_URL!), db = new URL(env.DATABASE_URL!);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.href !== origin.origin + '/' || publicUrl.href !== publicUrl.origin + '/' || publicUrl.origin !== origin.origin) throw Error('WEB_ORIGIN and WEB_PUBLIC_URL must identify the same HTTP(S) origin without paths or credentials.');
  if (origin.username || origin.password || publicUrl.username || publicUrl.password) throw Error('Web URLs cannot include credentials.');
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname || !db.username || !db.pathname || db.pathname === '/') throw Error('Configure the dedicated PostgreSQL application connection.');
  if (['postgres', 'careslot_owner'].includes(decodeURIComponent(db.username))) throw Error('The API must use its application role, not a PostgreSQL administrator/schema owner.');
  if (env.API_PORT && (!/^\d+$/.test(env.API_PORT) || Number(env.API_PORT) < 1 || Number(env.API_PORT) > 65535)) throw Error('API_PORT must be a valid port number.');
  if (env.NODE_ENV === 'production') {
    if (env.ALLOW_LAN_DEV === 'true') throw Error('Development Wi-Fi mode cannot be enabled in production.');
    if (env.COOKIE_SECURE !== 'true' || origin.protocol !== 'https:') throw Error('Production requires HTTPS and secure cookies.');
  } else if (env.ALLOW_LAN_DEV === 'true') {
    if (env.API_HOST !== '0.0.0.0' || !isPrivateIpv4(env.API_LAN_ADDRESS ?? '')) throw Error('Development Wi-Fi mode requires API_HOST=0.0.0.0 and a private IPv4 API_LAN_ADDRESS.');
  } else if (!['127.0.0.1', 'localhost', '::1'].includes(env.API_HOST ?? '127.0.0.1')) throw Error('Local development API must bind to loopback unless Wi-Fi mode is explicitly configured.');
}
