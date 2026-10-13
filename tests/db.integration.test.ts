// Test d'integrazione su un Postgres reale. Si attiva solo con TEST_DATABASE_URL, es.:
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/salone npm test
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { loadConfig } from '../lib/config';
import { createDbRepo } from '../lib/db/repo';
import * as schema from '../lib/db/schema';
import type { Repo } from '../lib/repo';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('repo Postgres (integrazione)', () => {
  let pool: pg.Pool;
  let repo: Repo;
  const T = '+393401234567';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 5 });
    await pool.query(readFileSync('drizzle/0001_init.sql', 'utf8'));
    await pool.query(readFileSync('drizzle/0001_init.sql', 'utf8')); // idempotente
    repo = createDbRepo({ db: drizzle(pool, { schema }) as any, pool });
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE clienti, appuntamenti, messaggi, servizi, impostazioni, messaggi_elaborati RESTART IDENTITY');
  });
  afterAll(async () => { await pool?.end(); });

  test('seed: servizi e impostazioni caricabili e config valida', async () => {
    await pool.query(readFileSync('drizzle/seed.sql', 'utf8'));
    await pool.query(readFileSync('drizzle/seed.sql', 'utf8')); // rieseguibile
    expect((await repo.servizi()).map((s) => s.nome)).toContain('Colore e taglio');
    const cfg = await loadConfig(repo);
    expect(cfg.orari.sabato).toEqual([['09:00', '17:00']]);
    expect(cfg.giorniChiusura).toContain('2026-12-25');
  });

  test('claimMessage: vero la prima volta, falso poi (anche in parallelo)', async () => {
    const r = await Promise.all([repo.claimMessage('m1'), repo.claimMessage('m1'), repo.claimMessage('m1')]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await repo.claimMessage('m2')).toBe(true);
  });

  test('withLock serializza davvero chiamate concorrenti con la stessa chiave', async () => {
    const ordine: string[] = [];
    const lavoro = (n: string) => repo.withLock('k', async () => { ordine.push(`in ${n}`); await new Promise((r) => setTimeout(r, 40)); ordine.push(`out ${n}`); });
    await Promise.all([lavoro('A'), lavoro('B'), lavoro('C')]);
    for (let i = 0; i < ordine.length; i += 2) expect(ordine[i].replace('in', 'out')).toBe(ordine[i + 1]);
  });

  test('withLock rilascia il lock anche se la funzione lancia', async () => {
    await expect(repo.withLock('k2', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await repo.withLock('k2', async () => 'ok')).toBe('ok');
  });

  test('cliente: creazione idempotente e aggiornamento preferenze', async () => {
    const [a, b] = await Promise.all([repo.getOrCreateCliente(T, 'Giulia'), repo.getOrCreateCliente(T, 'Giulia')]);
    expect(a.telefono).toBe(b.telefono);
    await repo.aggiornaCliente(T, { fasciaPreferita: 'mattina', consensoDati: true });
    expect(await repo.getOrCreateCliente(T, 'x')).toMatchObject({ nome: 'Giulia', fasciaPreferita: 'mattina', consensoDati: true, nVisite: 0 });
    await repo.aggiornaCliente(T, {}); // patch vuota: nessun errore
  });

  test('proposte -> conferma -> completamento aggiorna le visite', async () => {
    await repo.getOrCreateCliente(T, 'Giulia');
    const base = new Date('2026-10-17T07:00:00Z');
    const prop = [1, 2, 3].map((n) => ({ servizio: 'Taglio', inizio: new Date(base.getTime() + n * 86400000), fine: new Date(base.getTime() + n * 86400000 + 2700000), opzione: n }));
    await repo.sostituisciProposte(T, 'Giulia', prop);
    await repo.sostituisciProposte(T, 'Giulia', prop); // sostituisce, non duplica
    let righe = await repo.appuntamentiCliente(T);
    expect(righe).toHaveLength(3);
    expect(righe.map((r) => r.opzione)).toEqual([1, 2, 3]);
    expect(righe[0].inizio).toBeInstanceOf(Date);

    await repo.confermaProposta(righe[1].id, 'evt1', 'Giulia');
    await repo.eliminaProposte(T);
    righe = await repo.appuntamentiCliente(T);
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({ stato: 'confermato', eventId: 'evt1', opzione: null, nomeCliente: 'Giulia' });
    expect(await repo.appuntamentiConfermati()).toHaveLength(1);

    await repo.segnaPromemoria(righe[0].id);
    expect((await repo.appuntamentiConfermati())[0].promemoriaInviato).toBe(true);

    await repo.completaAppuntamento(righe[0].id);
    await repo.completaAppuntamento(righe[0].id); // seconda volta: nessun doppio conteggio
    const c = await repo.getOrCreateCliente(T, 'x');
    expect(c.nVisite).toBe(1);
    expect(c.ultimaVisita?.getTime()).toBe(righe[0].fine.getTime());
    expect((await repo.appuntamentiCliente(T))[0].stato).toBe('completato');
  });

  test('messaggi: ordine cronologico, limite, pulizia e cancellazione dati', async () => {
    const t0 = new Date('2026-10-01T10:00:00Z').getTime();
    await repo.aggiungiMessaggi(Array.from({ length: 15 }, (_, i) => ({ telefono: T, ruolo: i % 2 ? 'assistente' as const : 'cliente' as const, testo: `m${i}`, ts: new Date(t0 + i * 1000) })));
    const ultimi = await repo.ultimiMessaggi(T, 12);
    expect(ultimi.map((m) => m.testo)).toEqual(Array.from({ length: 12 }, (_, i) => `m${i + 3}`));
    expect(await repo.eliminaMessaggiPrima(new Date(t0 + 5000))).toBe(5);

    await repo.getOrCreateCliente(T, 'Giulia');
    await repo.sostituisciProposte(T, null, [{ servizio: 'Taglio', inizio: new Date(), fine: new Date(), opzione: 1 }]);
    await repo.getOrCreateCliente('+390000000001', 'Altro');
    await repo.cancellaDatiCliente(T);
    expect(await repo.ultimiMessaggi(T, 50)).toHaveLength(0);
    expect(await repo.appuntamentiCliente(T)).toHaveLength(0);
    const { rows } = await pool.query('SELECT telefono FROM clienti');
    expect(rows.map((r) => r.telefono)).toEqual(['+390000000001']);
  });
});
