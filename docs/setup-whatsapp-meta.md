# Setup WhatsApp Business Cloud API (Meta)

1. Vai su <https://developers.facebook.com> → **Create App** → tipo *Business* → aggiungi il prodotto **WhatsApp**.
2. Collega (o crea) un **Business Portfolio** e verifica l'attività se richiesto.
3. In *WhatsApp → API Setup* trovi **Phone number ID** (va in `config.local.json`) e un numero di test gratuito per i collaudi.
   Per la produzione aggiungi il numero del salone: dev'essere un numero **non già registrato** su WhatsApp/WhatsApp Business app (oppure da migrare).
4. **Token permanente:** *Business Settings → Utenti di sistema* → crea un utente di sistema, assegnagli l'app e genera un token con permessi `whatsapp_business_messaging` e `whatsapp_business_management`. Non usare il token temporaneo di 24 ore.
5. **Variabili su Vercel:** `WHATSAPP_TOKEN` (token permanente), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` (*App → Impostazioni → Di base → Chiave segreta*) e `WHATSAPP_VERIFY_TOKEN` (una stringa a tua scelta).
6. **Webhook:** *WhatsApp → Configuration → Webhook → Edit*. URL di callback `https://<tuo-dominio>/api/whatsapp`, token di verifica = `WHATSAPP_VERIFY_TOKEN`; poi **Subscribe** al campo `messages`. L'app verifica la firma `X-Hub-Signature-256` di ogni richiesta.
7. **Template di messaggio (obbligatori)** — WhatsApp consente testo libero solo entro 24 ore dall'ultimo messaggio del cliente. Per i messaggi proattivi crea e fai approvare in *WhatsApp Manager → Message templates* (categoria *Utility*, lingua *Italiano*):

   | Nome | Corpo | Variabili |
   |---|---|---|
   | `promemoria_appuntamento` | `Ciao {{1}}, le ricordiamo il suo appuntamento di domani, {{2}}, per {{3}}. Se non può venire ci avvisi rispondendo a questo messaggio. A presto!` | 1 nome, 2 giorno e ora, 3 servizio |
   | `notifica_titolare` | `Segnalazione dall'assistente: {{1}}. Dettaglio: {{2}}` | 1 cliente, 2 motivo |

   Senza questi template promemoria e avvisi alla titolare non partono (l'errore compare nei log di Vercel).
8. **Test:** aggiungi il tuo numero tra i destinatari del numero di test, scrivi "Ciao" e controlla i log in Vercel.
