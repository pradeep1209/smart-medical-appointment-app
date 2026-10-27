import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('MIGRATION_DATABASE_URL') },
});
