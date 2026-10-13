# Data Table da creare in n8n

In n8n: **Data tables → Create**. Nomi e colonne devono essere esattamente questi (tutto minuscolo).
Dopo averle create, annota l'ID di ciascuna (è nell'URL della tabella) per `config.local.json`.

## `clienti`
| Colonna | Tipo | Note |
|---|---|---|
| telefono | string | formato E.164, es. `+393401234567` (chiave logica) |
| nome | string | |
| giorni_preferiti | string | es. `sabato, martedi` (senza accenti) |
| fascia_preferita | string | `mattina` o `pomeriggio` |
| stilista_preferito | string | |
| note | string | solo preferenze organizzative, mai dati sanitari |
| ultima_visita | date | aggiornata da WF2 |
| n_visite | number | aggiornata da WF2 |
| n_no_show | number | la titolare la aggiorna a mano |
| consenso_dati | boolean | `true` dopo l'informativa privacy |

## `appuntamenti`
| Colonna | Tipo | Note |
|---|---|---|
| telefono | string | |
| nome_cliente | string | |
| servizio | string | |
| inizio | date | |
| fine | date | |
| stato | string | `proposto`, `confermato`, `completato`, `annullato`, `no_show` |
| opzione | number | 1–3, solo per gli slot `proposto` |
| event_id | string | ID evento Google Calendar |
| promemoria_inviato | boolean | |

## `messaggi`
| Colonna | Tipo |
|---|---|
| telefono | string |
| ruolo | string (`cliente` / `assistente`) |
| testo | string |
| ts | date |

Conservati 30 giorni (pulizia automatica in WF2).

## `servizi`
| Colonna | Tipo | Esempio |
|---|---|---|
| nome | string | `Taglio` |
| durata_min | number | `45` |
| buffer_min | number | `15` (pausa dopo il servizio) |
| prezzo | number | `25` |
| note | string | `include shampoo` |

Esempi: Taglio 45/15/25, Piega 30/10/15, Taglio e piega 60/15/35, Colore 120/0/60, Colore e taglio 150/15/80.

## `impostazioni` (chiave / valore, tutte stringhe)
| chiave | valore (esempio) |
|---|---|
| nome_salone | `Salone Bella` |
| id_calendario | ID del Google Calendar del salone (es. `abc123@group.calendar.google.com`) |
| orari | `{"lunedi":[],"martedi":[["09:00","13:00"],["15:00","19:00"]],"mercoledi":[["09:00","13:00"],["15:00","19:00"]],"giovedi":[["09:00","13:00"],["15:00","19:00"]],"venerdi":[["09:00","13:00"],["15:00","19:00"]],"sabato":[["09:00","17:00"]],"domenica":[]}` |
| giorni_chiusura | `["2026-12-25","2026-12-26","2027-01-01"]` |
| anticipo_min | `120` (preavviso minimo per prenotare) |
| orizzonte_giorni | `21` (fino a quanti giorni avanti cercare) |
| passo_min | `30` (granularità degli orari proposti) |
| telefono_titolare | `+393331112222` (riceve le segnalazioni) |

Nomi dei giorni senza accenti, in minuscolo: `lunedi … domenica`. Fuso orario: Europe/Rome.
