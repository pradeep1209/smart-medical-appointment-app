import { config } from 'dotenv';
import { resolve } from 'node:path';
import { validateEnvironment } from './config-policy';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
validateEnvironment(process.env);
