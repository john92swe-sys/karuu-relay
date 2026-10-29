import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.cwd();
mkdirSync(destination, { recursive: true });
const envFile = resolve(destination, '.env');
if (!existsSync(envFile)) {
  const template = readFileSync(resolve(project, '.env.example'), 'utf8');
  const content = template.replace('replace-with-a-long-random-local-key', randomBytes(32).toString('hex'));
  writeFileSync(envFile, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log('Created .env with a random gateway key. Keep this file private.');
} else {
  console.log('Preserved existing .env.');
}
const configFile = resolve(destination, 'config.json');
if (!existsSync(configFile)) {
  copyFileSync(resolve(project, 'config.example.json'), configFile, constants.COPYFILE_EXCL);
  console.log('Created config.json. Review provider models and quotas before real use.');
} else {
  console.log('Preserved existing config.json.');
}
console.log('Add your own provider keys to .env, then run npm start. No provider account was created or called.');
