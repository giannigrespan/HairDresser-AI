# Setup su Vercel

## 1. Progetto
1. Su <https://vercel.com> → **Add New → Project** → importa il repository GitHub. Framework: Next.js (rilevato da solo).
2. Il piano Hobby basta: il cron gira una volta al giorno (`vercel.json`, 08:00 UTC, cioè 09:00/10:00 in Italia).

## 2. Database Neon
1. Nel progetto: **Storage → Create Database → Neon** (Marketplace). Vercel aggiunge `DATABASE_URL` alle variabili d'ambiente.
2. Prepara le tabelle da locale (una volta):
   ```bash
   vercel env pull .env.local        # oppure esporta DATABASE_URL a mano
   DATABASE_URL="postgresql://..." npm run db:migrate -- --seed
   ```
   `--seed` carica servizi e impostazioni di esempio: **modificali** (vedi `docs/database.md`), soprattutto `id_calendario` e `telefono_titolare`.

## 3. Variabili d'ambiente (Settings → Environment Variables)
| Nome | Valore |
|---|---|
| `DATABASE_URL` | impostata dall'integrazione Neon |
| `GOOGLE_GENERATIVE_AI_API_KEY` | chiave di Google AI Studio |
| `WHATSAPP_TOKEN` | token permanente dell'utente di sistema Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del numero WhatsApp |
| `WHATSAPP_APP_SECRET` | App Secret dell'app Meta |
| `WHATSAPP_VERIFY_TOKEN` | stringa a tua scelta (la stessa va in Meta) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | contenuto del file JSON del service account, su una riga |
| `CRON_SECRET` | stringa casuale lunga (Vercel la invia al cron come `Bearer`) |
| `GEMINI_MODEL` | facoltativa, default `gemini-2.5-flash` |

Dopo aver inserito le variabili fai un nuovo deploy.

## 4. Webhook Meta
URL di callback: `https://<tuo-dominio>/api/whatsapp`, token di verifica = `WHATSAPP_VERIFY_TOKEN`, campo sottoscritto: `messages`. Dettagli in `docs/setup-whatsapp-meta.md`.

## 5. Controlli
- `https://<tuo-dominio>/` mostra la pagina di stato.
- *Deployments → Logs* mostra errori dell'agente e dei servizi esterni.
- Il cron si può lanciare a mano: `curl -H "Authorization: Bearer $CRON_SECRET" https://<tuo-dominio>/api/cron/daily`.

## Limiti da conoscere
- La risposta al cliente è elaborata dopo aver risposto a Meta (`after()`), con un massimo di 60 secondi per messaggio.
- Un servizio esterno che non risponde produce un messaggio di scuse al cliente e un avviso alla titolare (se il template `notifica_titolare` è approvato).
