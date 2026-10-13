CREATE TABLE IF NOT EXISTS clienti (
  telefono text PRIMARY KEY,
  nome text,
  giorni_preferiti text,
  fascia_preferita text,
  stilista_preferito text,
  note text,
  ultima_visita timestamptz,
  n_visite integer NOT NULL DEFAULT 0,
  n_no_show integer NOT NULL DEFAULT 0,
  consenso_dati boolean NOT NULL DEFAULT false,
  creato_il timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appuntamenti (
  id serial PRIMARY KEY,
  telefono text NOT NULL,
  nome_cliente text,
  servizio text NOT NULL,
  inizio timestamptz NOT NULL,
  fine timestamptz NOT NULL,
  stato text NOT NULL,
  opzione integer,
  event_id text,
  promemoria_inviato boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS appuntamenti_telefono_idx ON appuntamenti (telefono);
CREATE INDEX IF NOT EXISTS appuntamenti_stato_idx ON appuntamenti (stato);

CREATE TABLE IF NOT EXISTS messaggi (
  id serial PRIMARY KEY,
  telefono text NOT NULL,
  ruolo text NOT NULL,
  testo text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messaggi_telefono_ts_idx ON messaggi (telefono, ts);

CREATE TABLE IF NOT EXISTS servizi (
  nome text PRIMARY KEY,
  durata_min integer NOT NULL,
  buffer_min integer NOT NULL DEFAULT 0,
  prezzo integer,
  note text
);

CREATE TABLE IF NOT EXISTS impostazioni (
  chiave text PRIMARY KEY,
  valore text NOT NULL
);

CREATE TABLE IF NOT EXISTS messaggi_elaborati (
  message_id text PRIMARY KEY,
  creato_il timestamptz NOT NULL DEFAULT now()
);
