import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Repo } from '../repo';
import type { Appuntamento, Cliente, Messaggio, Servizio, StatoAppuntamento } from '../types';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { getDb, getPool, schema } from './client';

const { clienti, appuntamenti, messaggi, servizi, impostazioni, messaggiElaborati } = schema;

const toAppuntamento = (r: typeof appuntamenti.$inferSelect): Appuntamento => ({ ...r, stato: r.stato as StatoAppuntamento });

/** Connessione: di default Neon (produzione); nei test d'integrazione un Postgres locale con `pg`. */
export interface Connessione {
  db: PgDatabase<PgQueryResultHKT, typeof schema>;
  pool: { connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<unknown>; release(): void }> };
}

export function createDbRepo(conn?: Connessione): Repo {
  const db = (conn?.db ?? getDb()) as Connessione['db'];
  const pool = conn?.pool ?? getPool();

  return {
    async claimMessage(messageId) {
      const r = await db.insert(messaggiElaborati).values({ messageId }).onConflictDoNothing().returning({ id: messaggiElaborati.messageId });
      return r.length > 0;
    },

    // Lock di sessione su una connessione dedicata: viene rilasciato anche se il processo muore.
    async withLock(chiave, fn) {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [chiave]);
        try {
          return await fn();
        } finally {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [chiave]);
        }
      } finally {
        client.release();
      }
    },

    async getOrCreateCliente(telefono, nomeProfilo) {
      await db.insert(clienti).values({ telefono, nome: nomeProfilo || null }).onConflictDoNothing();
      const [c] = await db.select().from(clienti).where(eq(clienti.telefono, telefono));
      return c as Cliente;
    },

    async aggiornaCliente(telefono, patch) {
      if (Object.keys(patch).length) await db.update(clienti).set(patch).where(eq(clienti.telefono, telefono));
    },

    async appuntamentiCliente(telefono) {
      const rows = await db.select().from(appuntamenti).where(eq(appuntamenti.telefono, telefono)).orderBy(asc(appuntamenti.inizio));
      return rows.map(toAppuntamento);
    },

    async ultimiMessaggi(telefono, n) {
      const rows = await db.select().from(messaggi).where(eq(messaggi.telefono, telefono)).orderBy(desc(messaggi.ts), desc(messaggi.id)).limit(n);
      return rows.reverse().map((r): Messaggio => ({ telefono: r.telefono, ruolo: r.ruolo as Messaggio['ruolo'], testo: r.testo, ts: r.ts }));
    },

    async aggiungiMessaggi(righe) {
      if (righe.length) await db.insert(messaggi).values(righe);
    },

    async impostazioni() {
      const rows = await db.select().from(impostazioni);
      return Object.fromEntries(rows.map((r) => [r.chiave, r.valore]));
    },

    async servizi() {
      const rows = await db.select().from(servizi).orderBy(asc(servizi.nome));
      return rows as Servizio[];
    },

    async sostituisciProposte(telefono, nomeCliente, proposte) {
      await db.transaction(async (tx) => {
        await tx.delete(appuntamenti).where(and(eq(appuntamenti.telefono, telefono), eq(appuntamenti.stato, 'proposto')));
        if (proposte.length) {
          await tx.insert(appuntamenti).values(proposte.map((p) => ({ ...p, telefono, nomeCliente, stato: 'proposto' })));
        }
      });
    },

    async confermaProposta(id, eventId, nomeCliente) {
      await db.update(appuntamenti).set({ stato: 'confermato', eventId, nomeCliente, opzione: null }).where(eq(appuntamenti.id, id));
    },

    async eliminaProposte(telefono) {
      await db.delete(appuntamenti).where(and(eq(appuntamenti.telefono, telefono), eq(appuntamenti.stato, 'proposto')));
    },

    async appuntamentiConfermati() {
      const rows = await db.select().from(appuntamenti).where(eq(appuntamenti.stato, 'confermato'));
      return rows.map(toAppuntamento);
    },

    async segnaPromemoria(id) {
      await db.update(appuntamenti).set({ promemoriaInviato: true }).where(eq(appuntamenti.id, id));
    },

    async completaAppuntamento(id) {
      await db.transaction(async (tx) => {
        const [a] = await tx.update(appuntamenti).set({ stato: 'completato' }).where(and(eq(appuntamenti.id, id), eq(appuntamenti.stato, 'confermato'))).returning();
        if (a) {
          await tx.update(clienti)
            .set({ nVisite: sql`${clienti.nVisite} + 1`, ultimaVisita: a.fine })
            .where(eq(clienti.telefono, a.telefono));
        }
      });
    },

    async eliminaMessaggiPrima(data) {
      const r = await db.delete(messaggi).where(lt(messaggi.ts, data)).returning({ id: messaggi.id });
      await db.delete(messaggiElaborati).where(lt(messaggiElaborati.creatoIl, data));
      return r.length;
    },

    async cancellaDatiCliente(telefono) {
      await db.transaction(async (tx) => {
        await tx.delete(messaggi).where(eq(messaggi.telefono, telefono));
        await tx.delete(appuntamenti).where(eq(appuntamenti.telefono, telefono));
        await tx.delete(clienti).where(inArray(clienti.telefono, [telefono]));
      });
    },
  };
}
