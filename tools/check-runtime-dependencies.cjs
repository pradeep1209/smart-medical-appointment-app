const path = require('node:path'), fs = require('node:fs');
const root = path.resolve(__dirname, '..');
function metadata(name, from = root) {
 let directory = path.dirname(require.resolve(name, { paths: [from] }));
 while (true) {
  const candidate = path.join(directory, 'package.json');
  if (fs.existsSync(candidate)) { const value = JSON.parse(fs.readFileSync(candidate, 'utf8')); if (value.name === name) return value; }
  const parent = path.dirname(directory); if (parent === directory) throw Error(`Package metadata not found: ${name}`); directory = parent;
 }
}
const platform = path.dirname(require.resolve('@nestjs/platform-express', { paths: [root] }));
const multer = metadata('multer', platform).version;
const limiter = metadata('express-rate-limit').version;
function atLeast(actual, expected) { const a = actual.split('.').map(Number), b = expected.split('.').map(Number); for (let i = 0; i < 3; i++) { if (a[i] > b[i]) return true; if (a[i] < b[i]) return false; } return true; }
if (!atLeast(multer, '2.5.0') || !atLeast(limiter, '8.2.2')) throw Error('A runtime security patch is missing. Restore the checked-in lockfile and run npm ci; do not use npm update.');
console.log(`Runtime dependency guard PASS: multer ${multer}, express-rate-limit ${limiter}`);
