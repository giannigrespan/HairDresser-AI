import { boolean, integer, pgTable, serial, text, timestamp, index } from 'drizzle-orm/pg-core';

const tstz = (nome: string) => timestamp(nome, { withTimezone: true });

export const clienti = pgTable('clienti', {
  telefono: text('telefono').primaryKey(),
  nome: text('nome'),
  giorniPreferiti: text('giorni_preferiti'),
  fasciaPreferita: text('fascia_preferita'),
  stilistaPreferito: text('stilista_preferito'),
  note: text('note'),
  ultimaVisita: tstz('ultima_visita'),
  nVisite: integer('n_visite').notNull().default(0),
  nNoShow: integer('n_no_show').notNull().default(0),
  consensoDati: boolean('consenso_dati').notNull().default(false),
  creatoIl: tstz('creato_il').notNull().defaultNow(),
});

export const appuntamenti = pgTable('appuntamenti', {
  id: serial('id').primaryKey(),
  telefono: text('telefono').notNull(),
  nomeCliente: text('nome_cliente'),
  servizio: text('servizio').notNull(),
  inizio: tstz('inizio').notNull(),
  fine: tstz('fine').notNull(),
  stato: text('stato').notNull(),
  opzione: integer('opzione'),
  eventId: text('event_id'),
  promemoriaInviato: boolean('promemoria_inviato').notNull().default(false),
}, (t) => [index('appuntamenti_telefono_idx').on(t.telefono), index('appuntamenti_stato_idx').on(t.stato)]);

export const messaggi = pgTable('messaggi', {
  id: serial('id').primaryKey(),
  telefono: text('telefono').notNull(),
  ruolo: text('ruolo').notNull(),
  testo: text('testo').notNull(),
  ts: tstz('ts').notNull().defaultNow(),
}, (t) => [index('messaggi_telefono_ts_idx').on(t.telefono, t.ts)]);

export const servizi = pgTable('servizi', {
  nome: text('nome').primaryKey(),
  durataMin: integer('durata_min').notNull(),
  bufferMin: integer('buffer_min').notNull().default(0),
  prezzo: integer('prezzo'),
  note: text('note'),
});

export const impostazioni = pgTable('impostazioni', {
  chiave: text('chiave').primaryKey(),
  valore: text('valore').notNull(),
});

export const messaggiElaborati = pgTable('messaggi_elaborati', {
  messageId: text('message_id').primaryKey(),
  creatoIl: tstz('creato_il').notNull().defaultNow(),
});
