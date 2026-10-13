// Applica drizzle/0001_init.sql (e, con --seed, drizzle/seed.sql) al database in DATABASE_URL.
// Uso: DATABASE_URL=... npm run db:migrate [-- --seed]
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL non impostata');
const pool = new Pool({ connectionString: url });
const files = ['drizzle/0001_init.sql', ...(process.argv.includes('--seed') ? ['drizzle/seed.sql'] : [])];
for (const f of files) {
  await pool.query(readFileSync(f, 'utf8'));
  console.log('applicato', f);
}
await pool.end();
