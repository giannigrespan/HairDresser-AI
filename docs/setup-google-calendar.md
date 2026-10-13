# Setup Google Calendar

1. Crea un **calendario dedicato** (es. "Appuntamenti salone") su Google Calendar, oppure usa quello esistente. Più calendari/stilisti non sono ancora gestiti: l'assistente considera un solo calendario.
2. Impostazioni del calendario → *Integra il calendario* → copia l'**ID calendario** (es. `abc123@group.calendar.google.com`) nella riga `id_calendario` della tabella `impostazioni`.
3. **Credenziali OAuth2 in n8n** (credenziale *Google Calendar OAuth2 API*):
   - Google Cloud Console → crea progetto → abilita **Google Calendar API**.
   - Schermata consenso OAuth (tipo *Esterno*, pubblica l'app in produzione per evitare la scadenza del token dopo 7 giorni).
   - Crea un *ID client OAuth* di tipo *Web* e inserisci come URI di reindirizzamento quello mostrato da n8n nella credenziale.
   - Incolla Client ID e Secret in n8n e premi *Sign in with Google* con l'account proprietario del calendario.
4. Gli eventi segnati "disponibile/trasparente" o annullati vengono ignorati; quelli "tutto il giorno" bloccano l'intera giornata (usali per ferie e chiusure straordinarie, oppure aggiungi la data a `giorni_chiusura`).
5. Gli appuntamenti inseriti a mano dalla titolare nel calendario vengono rispettati automaticamente al calcolo degli slot.
