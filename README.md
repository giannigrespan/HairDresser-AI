# HairDresser-AI — assistente WhatsApp per parrucchiera

App **Next.js su Vercel** con **Gemini**, **Google Calendar** e **Neon Postgres** che:

- legge e risponde ai messaggi WhatsApp dei clienti (WhatsApp Business Cloud API), con tono caldo e professionale;
- controlla il Google Calendar e propone **3 date/orari reali** in base al servizio richiesto;
- crea l'evento in agenda **solo dopo la conferma del cliente**;
- ricorda le abitudini di ogni cliente (giorno, fascia oraria, servizio, cadenza) dallo storico;
- manda promemoria 24 ore prima e avvisa la titolare quando serve una persona.

## Come funziona

```
Meta WhatsApp ─► POST /api/whatsapp  (firma verificata, 200 subito)
                    └─ in background: dedup → lock per cliente → contesto dal DB → Gemini + strumenti → risposta WhatsApp → log
Vercel Cron   ─► GET /api/cron/daily  (ogni mattina): promemoria, chiusura appuntamenti, pulizia messaggi
```

Strumenti a disposizione dell'agente: `proponi_slot`, `prenota_appuntamento`, `salva_preferenza`, `passa_alla_titolare`, `cancella_dati_cliente`.

Scelte di progetto importanti:

- **Gli orari non li inventa l'AI.** Gli slot sono calcolati da codice (`lib/slots.ts`) incrociando orari di apertura, durata+pausa del servizio, eventi del calendario e preferenze del cliente. Gemini li riceve pronti e li presenta con garbo.
- **Nessuna data libera dall'AI.** Le 3 proposte vengono salvate; il cliente sceglie "la seconda" e la prenotazione usa quella riga. Prima di creare l'evento lo slot viene **ricontrollato** sul calendario, con un lock globale (niente doppie prenotazioni).
- **Il telefono del cliente non passa mai dal modello:** è fissato dal server in ogni strumento.
- **Un messaggio alla volta per cliente** (lock su Postgres) e **deduplica** dei ritentativi di Meta.
- **Memoria** su Postgres: profilo, storico appuntamenti e ultimi messaggi vengono ricostruiti a ogni messaggio e inseriti nel prompt.

## Struttura

| Percorso | Contenuto |
|---|---|
| `app/api/whatsapp`, `app/api/cron/daily` | Webhook WhatsApp e job giornaliero |
| `lib/slots.ts` | Calcolo slot e analisi abitudini (logica pura) |
| `lib/actions.ts`, `lib/tools.ts` | Le 5 azioni dell'agente e la loro esposizione a Gemini |
| `lib/handler.ts`, `lib/context.ts`, `lib/agent.ts` | Elaborazione del messaggio, contesto, chiamata al modello |
| `lib/db/`, `drizzle/` | Schema, repository Postgres, migrazione e dati di esempio |
| `prompts/system_prompt.md` | Prompt dell'assistente (tono e regole) |
| `docs/` | Guide: Vercel, WhatsApp/Meta, Google Calendar, database, privacy |
| `tests/` | Test automatici e `scenari.md` (collaudo manuale) |

## Installazione

1. **Vercel + Neon** → `docs/setup-vercel.md` (progetto, database, variabili d'ambiente, migrazione).
2. **Meta / WhatsApp** → `docs/setup-whatsapp-meta.md` (app, numero, token, webhook, template da approvare).
3. **Google Calendar** → `docs/setup-google-calendar.md` (service account, condivisione calendario).
4. **Gemini** → API key da Google AI Studio in `GOOGLE_GENERATIVE_AI_API_KEY`.
5. **Dati del salone** → servizi e orari nelle tabelle `servizi` e `impostazioni` (vedi `docs/database.md`).
6. Esegui gli scenari di `tests/scenari.md` con il numero di test di Meta prima di andare in produzione.

## Sviluppo

```bash
npm install
npm test            # test unitari e di flusso (senza servizi esterni)
npm run lint        # controllo dei tipi
npm run build
# facoltativo: test sul database reale
TEST_DATABASE_URL=postgresql://... npm test
```

> **Onestà sui test:** la logica è coperta da test automatici e il livello dati è stato verificato su un Postgres 16 reale, ma l'app non è mai stata eseguita contro WhatsApp, Gemini, Google Calendar e Neon reali. Il primo collaudo end-to-end con il numero di test Meta va fatto da te (`tests/scenari.md`).

## Personalizzazione

- **Tono e regole:** `prompts/system_prompt.md`.
- **Orari, ferie, durate, prezzi:** tabelle `impostazioni` e `servizi` (SQL dalla console Neon), senza modificare il codice.
- **Modello:** variabile `GEMINI_MODEL` (default `gemini-2.5-flash`).
