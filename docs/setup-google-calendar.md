# Setup Google Calendar (service account)

Si usa un **service account**: nessun login interattivo e nessun token che scade dopo 7 giorni.

1. Crea un **calendario dedicato** (es. "Appuntamenti salone") su Google Calendar, oppure usa quello esistente. È gestito un solo calendario.
2. Impostazioni del calendario → *Integra il calendario* → copia l'**ID calendario** nella riga `id_calendario` della tabella `impostazioni`.
3. Google Cloud Console → crea un progetto → abilita **Google Calendar API**.
4. *IAM e amministrazione → Account di servizio* → crea un account → *Chiavi → Aggiungi chiave → JSON*. Il contenuto del file, su una riga, va in `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Nel calendario → *Condividi con persone e gruppi* → aggiungi l'**email del service account** (`...@...iam.gserviceaccount.com`) con permesso **Apporta modifiche agli eventi**.
6. Gli eventi segnati "disponibile/trasparente" o annullati vengono ignorati; quelli "tutto il giorno" bloccano l'intera giornata (usali per ferie e chiusure, oppure aggiungi la data a `giorni_chiusura`).
7. Gli appuntamenti inseriti a mano nel calendario vengono rispettati automaticamente.
