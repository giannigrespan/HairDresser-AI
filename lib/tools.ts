import { tool } from 'ai';
import { z } from 'zod';
import * as azioni from './actions';
import type { Sessione } from './actions';
import type { Deps } from './ports';
import type { Config } from './types';

/** Strumenti esposti al modello. Il telefono è incorporato nella sessione, non è un parametro. */
export function creaStrumenti(d: Deps, cfg: Config, sess: Sessione) {
  return {
    proponi_slot: tool({
      description: 'Calcola 3 date/orari liberi in agenda per il servizio richiesto. Usalo SEMPRE prima di proporre un appuntamento. Restituisce gli slot numerati con il campo etichetta da mostrare al cliente.',
      inputSchema: z.object({
        servizio: z.string().describe('Nome del servizio richiesto, es. Taglio, Colore, Piega'),
        giorniPreferiti: z.string().optional().describe('Giorni preferiti separati da virgola (es. sabato, martedi). Vuoto se nessuna preferenza.'),
        fasciaPreferita: z.string().optional().describe('mattina oppure pomeriggio. Vuoto se nessuna preferenza.'),
      }),
      execute: (a) => azioni.proponiSlot(d, cfg, sess, a),
    }),
    prenota_appuntamento: tool({
      description: 'Conferma e inserisce in agenda uno degli slot già proposti. Chiamalo SOLO dopo che il cliente ha confermato chiaramente una opzione.',
      inputSchema: z.object({ opzione: z.number().int().min(1).max(3).describe("Numero (1, 2 o 3) dell'opzione scelta tra gli slot già proposti") }),
      execute: (a) => azioni.prenota(d, cfg, sess, a),
    }),
    salva_preferenza: tool({
      description: 'Salva una preferenza stabile del cliente. chiave ammessa: nome, giorniPreferiti, fasciaPreferita, stilistaPreferito, note, consensoDati. Mai dati sanitari.',
      inputSchema: z.object({
        chiave: z.enum(['nome', 'giorniPreferiti', 'fasciaPreferita', 'stilistaPreferito', 'note', 'consensoDati']),
        valore: z.string().describe('Valore da salvare'),
      }),
      execute: (a) => azioni.salvaPreferenza(d, sess, a),
    }),
    passa_alla_titolare: tool({
      description: 'Avvisa la titolare quando serve una persona: reclami, spostamenti entro 24 ore, richieste fuori listino, questioni di salute o dubbi.',
      inputSchema: z.object({ motivo: z.string().describe('Breve riassunto del motivo, in una frase') }),
      execute: (a) => azioni.passaAllaTitolare(d, cfg, sess, a),
    }),
    cancella_dati_cliente: tool({
      description: 'Cancella definitivamente i dati del cliente (profilo, storico, messaggi) SOLO se lo chiede esplicitamente.',
      inputSchema: z.object({}),
      execute: () => azioni.cancellaDati(d, sess),
    }),
  };
}
