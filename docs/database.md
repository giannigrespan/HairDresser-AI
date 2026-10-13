# Database

Postgres su Neon. Lo schema è in `drizzle/0001_init.sql` (e `lib/db/schema.ts`); i dati di esempio in `drizzle/seed.sql`.
Per modificare i dati usa l'**SQL Editor** della console Neon.

| Tabella | Contenuto |
|---|---|
| `clienti` | telefono (E.164, chiave), nome, giorni/fascia/stilista preferiti, note, ultima visita, n. visite, no-show, consenso privacy |
| `appuntamenti` | telefono, servizio, inizio, fine, stato (`proposto`, `confermato`, `completato`, `annullato`, `no_show`), opzione 1–3 (solo proposte), `event_id` Google, promemoria inviato |
| `messaggi` | ultimi messaggi per il contesto (conservati 30 giorni) |
| `servizi` | nome, durata, pausa dopo il servizio, prezzo, note |
| `impostazioni` | chiave/valore (sotto) |
| `messaggi_elaborati` | ID dei messaggi WhatsApp già visti (deduplica) |

## Impostazioni (`impostazioni`, tutte stringhe)
| chiave | esempio |
|---|---|
| `nome_salone` | `Salone Bella` |
| `id_calendario` | `abc123@group.calendar.google.com` (obbligatoria) |
| `orari` | JSON: `{"lunedi":[],"martedi":[["09:00","13:00"],["15:00","19:00"]],...,"domenica":[]}` (giorni minuscoli senza accenti) |
| `giorni_chiusura` | `["2026-12-25","2027-01-01"]` |
| `anticipo_min` | `120` — preavviso minimo per prenotare |
| `orizzonte_giorni` | `21` — fino a quanti giorni avanti cercare |
| `passo_min` | `30` — granularità degli orari proposti |
| `telefono_titolare` | `+393331112222` — riceve le segnalazioni |

Esempi di modifica:
```sql
UPDATE impostazioni SET valore = '["2026-12-24","2026-12-25"]' WHERE chiave = 'giorni_chiusura';
INSERT INTO servizi (nome, durata_min, buffer_min, prezzo, note) VALUES ('Balayage', 180, 0, 120, NULL)
  ON CONFLICT (nome) DO UPDATE SET durata_min = EXCLUDED.durata_min, prezzo = EXCLUDED.prezzo;
UPDATE clienti SET n_no_show = n_no_show + 1 WHERE telefono = '+393401234567';
```
