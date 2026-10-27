import type { NextConfig } from 'next';
import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const path = resolve(process.cwd(), '../../.env');
const local = existsSync(path) ? parse(readFileSync(path)) : {};
const api = process.env.API_INTERNAL_URL ?? `http://127.0.0.1:${local.API_PORT ?? '3001'}`;
process.env.API_INTERNAL_URL = api;
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() { return [{ source: '/api/:path*', destination: `${api}/api/:path*` }]; },
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'same-origin' },
    { key: 'Cache-Control', value: 'private, no-store' },
  ] }]; },
};
export default config;
