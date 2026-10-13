# Privacy e GDPR (indicazioni operative)

Questo documento non è una consulenza legale: fai verificare informativa e registro dei trattamenti al tuo consulente.

**Dati trattati:** numero di telefono, nome, preferenze organizzative (giorni, fasce, stilista), storico appuntamenti, ultimi messaggi (30 giorni).
**Dati da non trattare:** dati sanitari (allergie, patologie, reazioni). L'assistente è istruito a non salvarli e a passare tali richieste alla titolare.

- **Informativa e consenso:** al primo contatto l'assistente informa che conserva nome e preferenze e che possono essere cancellati; quando il cliente acconsente viene salvato `consenso_dati = true`. Pubblica anche un'informativa completa (es. link nel profilo WhatsApp Business).
- **Cancellazione:** se il cliente scrive "cancella i miei dati" l'assistente usa lo strumento `cancella_dati_cliente`, che elimina profilo, appuntamenti e messaggi dal database. Restano gli eventi già creati in Google Calendar (eliminali a mano se richiesto).
- **Minimizzazione:** i messaggi più vecchi di 30 giorni sono cancellati ogni giorno (job giornaliero).
- **Sub-responsabili:** i messaggi vengono elaborati da Meta (WhatsApp), Google (Gemini, Calendar) e Vercel/Neon (database). Verifica che i relativi accordi (DPA) siano accettati; per Gemini usa un piano/API che non utilizzi i dati per addestrare i modelli.
- **Accesso:** abilita la 2FA su Vercel, Neon, Meta e Google; non committare mai token o file `.env` (sono in `.gitignore`).
