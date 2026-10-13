import { loadConfig } from './config';
import { buildContesto } from './context';
import type { Sessione } from './actions';
import type { Deps } from './ports';
import { renderPrompt } from './prompt';
import { creaStrumenti } from './tools';
import type { MessaggioInArrivo } from './whatsapp';

export const RISPOSTA_NON_TESTO =
  'Grazie per il messaggio 😊 Per ora riesco a leggere solo messaggi scritti: può scrivermi a parole di cosa ha bisogno? Se preferisce, la titolare la ricontatterà appena possibile.';
export const RISPOSTA_ERRORE =
  'Mi scusi, ho un piccolo problema tecnico in questo momento 🙏 La ricontatteremo a breve.';

/** Elabora un messaggio WhatsApp: dedup, contesto, agente, risposta, log. Non lancia eccezioni verso il chiamante. */
export async function gestisciMessaggio(d: Deps, msg: MessaggioInArrivo): Promise<'ignorato' | 'risposto' | 'errore'> {
  if (!(await d.repo.claimMessage(msg.id))) return 'ignorato'; // ritentativo di Meta

  try {
    return await d.repo.withLock(`cliente:${msg.telefono}`, async () => {
      if (msg.testo === null || !msg.testo.trim()) {
        await d.whatsapp.sendText(msg.telefono, RISPOSTA_NON_TESTO);
        return 'risposto';
      }
      const cfg = await loadConfig(d.repo);
      const cliente = await d.repo.getOrCreateCliente(msg.telefono, msg.nome);
      const sess: Sessione = { telefono: msg.telefono, nome: cliente.nome || msg.nome, datiCancellati: false };
      const now = d.now();
      const vars = await buildContesto(d.repo, cfg, cliente, msg.nome, now);

      let risposta = '';
      try {
        risposta = (await d.agent({ system: renderPrompt(vars), text: msg.testo, tools: creaStrumenti(d, cfg, sess) })).trim();
      } catch (e) {
        console.error('[agente]', e);
      }
      if (!risposta) {
        await d.whatsapp.sendText(msg.telefono, RISPOSTA_ERRORE);
        await avvisaTitolare(d, cfg.telefonoTitolare, `Errore assistente con ${msg.telefono}`, 'Risposta non generata, il cliente è stato avvisato.');
        return 'errore';
      }
      await d.whatsapp.sendText(msg.telefono, risposta);
      if (!sess.datiCancellati) {
        await d.repo.aggiungiMessaggi([
          { telefono: msg.telefono, ruolo: 'cliente', testo: msg.testo, ts: now },
          { telefono: msg.telefono, ruolo: 'assistente', testo: risposta, ts: new Date(now.getTime() + 1000) },
        ]);
      }
      return 'risposto';
    });
  } catch (e) {
    console.error('[handler]', e);
    return 'errore';
  }
}

async function avvisaTitolare(d: Deps, telefono: string | null, cosa: string, dettaglio: string) {
  if (!telefono) return;
  try { await d.whatsapp.sendTemplate(telefono, 'notifica_titolare', [cosa, dettaglio]); } catch (e) { console.error('[avviso titolare]', e); }
}
