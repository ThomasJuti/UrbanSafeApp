import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// dbmate lee DATABASE_URL. Con SSL, fuerza la verificación de la CA de Supabase.
const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const url = new URL(raw);
const sslmode = url.searchParams.get('sslmode');
if (sslmode && sslmode !== 'disable') {
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', fileURLToPath(new URL('../db/supabase-ca.crt', import.meta.url)));
}

const bin = fileURLToPath(new URL('../node_modules/.bin/dbmate', import.meta.url));
const child = spawn(bin, ['--migrations-dir', 'db/migrations', '--no-dump-schema', ...process.argv.slice(2)], {
  env: { ...process.env, DATABASE_URL: url.toString() },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
