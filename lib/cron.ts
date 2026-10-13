import type { Deps } from './ports';
import { etichetta, localDateStr } from './slots';

export interface EsitoCron { promemoria: number; errori: number; completati: number; messaggiEliminati: number }

const GIORNI_MESSAGGI = 30;

/** Job giornaliero: promemoria per domani, chiusura appuntamenti passati, pulizia messaggi vecchi. */
export async function eseguiCronGiornaliero(d: Deps): Promise<EsitoCron> {
  const now = d.now().getTime();
  const esito: EsitoCron = { promemoria: 0, errori: 0, completati: 0, messaggiEliminati: 0 };
  const confermati = await d.repo.appuntamentiConfermati();
  const domani = localDateStr(now + 24 * 3600000);

  for (const a of confermati) {
    if (a.promemoriaInviato || a.inizio.getTime() <= now || localDateStr(a.inizio.getTime()) !== domani) continue;
    try {
      await d.whatsapp.sendTemplate(a.telefono, 'promemoria_appuntamento', [a.nomeCliente || 'cliente', etichetta(a.inizio.getTime()), a.servizio]);
      await d.repo.segnaPromemoria(a.id);
      esito.promemoria++;
    } catch (e) {
      console.error('[cron promemoria]', a.id, e);
      esito.errori++;
    }
  }
  for (const a of confermati) {
    if (a.fine.getTime() >= now) continue;
    try { await d.repo.completaAppuntamento(a.id); esito.completati++; } catch (e) { console.error('[cron completa]', a.id, e); esito.errori++; }
  }
  esito.messaggiEliminati = await d.repo.eliminaMessaggiPrima(new Date(now - GIORNI_MESSAGGI * 86400000));
  return esito;
}
