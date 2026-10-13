# HairDresser-AI — assistente WhatsApp per parrucchiera

Assistente basato su **n8n + Google Gemini + Google Calendar + WhatsApp Business Cloud API** che:

- legge e risponde ai messaggi WhatsApp dei clienti, con tono caldo e professionale;
- controlla il Google Calendar e propone **3 date/orari reali** in base al servizio richiesto;
- crea l'evento in agenda **solo dopo la conferma del cliente**;
- ricorda le abitudini dei clienti (giorno, fascia oraria, servizio, cadenza) dallo storico;
- manda promemoria 24 ore prima e avvisa la titolare nei casi che richiedono una persona.

## Come funziona

```
Cliente WhatsApp ─► [01 Chat] ─► Gemini (agente) ─► risposta WhatsApp
                                   │ strumenti
                                   ├─ proponi_slot ────────► [03 Calcolo slot]  (Calendar + orari + durata servizio)
                                   ├─ prenota_appuntamento ┐
                                   ├─ salva_preferenza     ├► [04 Azioni agente] (ricontrolla slot, crea evento)
                                   ├─ passa_alla_titolare  │
                                   └─ cancella_dati_cliente┘
[02 Promemoria e storico]  ogni giorno 09:00: promemoria, chiusura appuntamenti, pulizia messaggi
[05 Avviso errori]         avvisa la titolare se un workflow fallisce
```

Scelte di progetto importanti:

- **Gli orari non li inventa l'AI.** Gli slot sono calcolati da codice deterministico (`src/lib.js`) incrociando orari di apertura, durata+pausa del servizio, eventi del calendario e preferenze del cliente. Gemini li riceve già pronti e li presenta con garbo.
- **Nessuna data libera dall'AI.** Le 3 proposte vengono salvate in tabella; il cliente sceglie "l'opzione 2" e la prenotazione usa quella riga. Prima di creare l'evento lo slot viene **ricontrollato** sul calendario (niente doppie prenotazioni).
- **Il telefono del cliente non passa mai dall'AI**: è iniettato dal workflow in ogni strumento.
- **Memoria** nelle Data Table di n8n: profilo, storico appuntamenti e ultimi messaggi vengono ricostruiti a ogni messaggio e inseriti nel prompt.

## Struttura del repository

| Percorso | Contenuto |
|---|---|
| `workflows/*.json` | Workflow n8n da importare (generati) |
| `src/lib.js` | Logica slot / abitudini, testata, incorporata nei nodi Code |
| `prompts/system_prompt.md` | Prompt dell'assistente (modificalo per cambiare tono e regole) |
| `scripts/` | `build_workflows.js` (genera i JSON), `configure.js` (inserisce gli ID), `validate_workflows.js` |
| `data-tables/schema.md` | Colonne delle 5 Data Table da creare |
| `docs/` | Guide: WhatsApp/Meta, Google Calendar, privacy |
| `tests/` | Test automatici (`npm test`) e scenari manuali (`scenari.md`) |

Dopo aver modificato `src/lib.js` o `prompts/system_prompt.md`: `npm run build && npm run validate && npm test`.

## Installazione (n8n su VPS Hostinger)

Requisiti: n8n ≥ 1.113 (serve il nodo **Data table**), HTTPS pubblico con `WEBHOOK_URL` impostato.

1. **Meta / WhatsApp** → segui `docs/setup-whatsapp-meta.md` (app, numero, token, template da approvare).
2. **Google Calendar** → `docs/setup-google-calendar.md` (credenziali OAuth2, calendario dedicato).
3. **Gemini** → crea una API key su Google AI Studio e aggiungi la credenziale *Google Gemini (PaLM) API* in n8n.
4. **Data Table** → crea le 5 tabelle di `data-tables/schema.md` e compila `impostazioni` e `servizi`.
5. Copia `config.example.json` in `config.local.json` e inserisci `phone_number_id` e gli ID delle tabelle.
6. **Importa nell'ordine** (Workflows → Import from file), poi annota l'ID di ciascun workflow dall'URL:
   `workflows/03-calcolo-slot.json`, `04-azioni-agente.json`, `05-avviso-errori.json` — dopo aver eseguito `node scripts/configure.js` usa i file in `dist/`.
   Poi inserisci in `config.local.json` gli ID `slot`, `azioni`, `errori`, riesegui `node scripts/configure.js` e importa `dist/01-chat-whatsapp.json` e `dist/02-promemoria-storico.json`.
7. In ogni workflow seleziona le credenziali nei nodi (WhatsApp, Google Calendar, Gemini) e **pubblica** (Active) i workflow 01, 02 e 05. I workflow 03 e 04 sono chiamati come sotto-workflow.
8. Esegui gli scenari di `tests/scenari.md` con il numero di test di Meta prima di andare in produzione.

> **Nota onesta:** i workflow sono generati da codice e la logica è testata con un mock dell'ambiente n8n, ma non sono mai stati eseguiti su un'istanza n8n reale. Alcuni nomi di parametri dei nodi (Data table, WhatsApp, Agente) possono differire leggermente tra versioni di n8n: se all'import un nodo mostra un avviso, apri il nodo, ricontrolla/risalva i campi e basta. La guida di collaudo è in `tests/scenari.md`.

## Personalizzazione rapida

- **Tono e regole:** `prompts/system_prompt.md`, poi `npm run build`.
- **Orari, ferie, durate, prezzi:** direttamente nelle Data Table `impostazioni` e `servizi`, nessuna modifica ai workflow.
- **Modello:** nel nodo *Gemini* (di default `gemini-2.5-flash`, temperatura 0.3).
