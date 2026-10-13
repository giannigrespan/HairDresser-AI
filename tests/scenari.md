# Scenari di collaudo manuale

Esegui con il numero di test Meta. Dopo ogni scenario controlla le esecuzioni in n8n e le Data Table.
Test automatici della logica: `npm test`.

| # | Cosa scrivi | Risultato atteso |
|---|---|---|
| 1 | "Buongiorno, vorrei prenotare un taglio" (cliente nuovo) | Saluto caldo, breve nota privacy, **3 opzioni numerate** per "Taglio"; riga cliente creata; 3 righe `proposto` in `appuntamenti` |
| 2 | "La seconda va bene" | Conferma con giorno/ora/servizio; evento nel Google Calendar; riga `confermato` con `event_id`; le altre proposte cancellate |
| 3 | "Preferisco sempre il sabato mattina" | Preferenza salvata in `clienti` (`giorni_preferiti`, `fascia_preferita`) |
| 4 | Dopo qualche visita (anche inserite a mano in `appuntamenti` come `completato`): "Ciao, vorrei prenotare" | Propone il servizio abituale e orari coerenti con giorno/fascia abituali; riconosce il cliente per nome |
| 5 | Crea un evento che occupa le 3 proposte, poi rispondi "la prima" | "Slot non più disponibile", scuse e **nuove 3 opzioni** (nessun evento duplicato) |
| 6 | "Vorrei una keratina" (non in listino) | Non inventa prezzi/orari; avvisa la titolare (`passa_alla_titolare`) e rassicura il cliente |
| 7 | "Sono molto delusa dal colore dell'ultima volta" | Risposta empatica + notifica alla titolare |
| 8 | "Devo spostare l'appuntamento di domani" | Passa alla titolare (entro 24 ore) |
| 9 | Invia una nota vocale o una foto | Risposta gentile che chiede di scrivere a parole |
| 10 | Rimanda lo stesso webhook (ri-esegui/ritenta) | Nessuna doppia risposta (nodo *Evita duplicati*) |
| 11 | "Non ho più disponibilità per tre settimane": riempi il calendario per 21 giorni | Scuse e richiesta di altri giorni/fasce; nessun orario inventato |
| 12 | "Cancella i miei dati" | Conferma; righe del cliente eliminate da `clienti`, `appuntamenti`, `messaggi` |
| 13 | Imposta un appuntamento `confermato` per domani e lancia manualmente il workflow 02 | Arriva il template di promemoria; `promemoria_inviato = true`; appuntamenti passati → `completato`, `n_visite` +1 |
| 14 | Disattiva il token WhatsApp e invia un messaggio | La titolare riceve l'avviso del workflow 05 |
