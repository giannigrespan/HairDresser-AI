import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

let pool: Pool | undefined;

/** Pool condiviso (Node 22+ ha WebSocket globale, nessuna configurazione extra). */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL non impostata');
    pool = new Pool({ connectionString });
    pool.on('error', (err: Error) => console.error('[db] errore pool', err));
  }
  return pool;
}

export const getDb = () => drizzle(getPool(), { schema });
export { schema };
