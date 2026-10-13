import type { Repo } from './repo';
import { analizzaAbitudini, etichetta, TZ } from './slots';
import type { Cliente, Config } from './types';

const NOMI_GIORNI = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'] as const;

/** Variabili del prompt di sistema, ricostruite a ogni messaggio dallo stato nel database. */
export async function buildContesto(repo: Repo, cfg: Config, cliente: Cliente, nomeProfilo: string, now: Date): Promise<Record<string, string>> {
  const [appunt, messaggi, servizi] = await Promise.all([
    repo.appuntamentiCliente(cliente.telefono),
    repo.ultimiMessaggi(cliente.telefono, 12),
    repo.servizi(),
  ]);
  const ab = analizzaAbitudini(appunt);
  const storico = 'servizioAbituale' in ab ? ab : null;

  const adesso = new Intl.DateTimeFormat('it-IT', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);

  const pref = [
    cliente.giorniPreferiti && `giorni preferiti: ${cliente.giorniPreferiti}`,
    cliente.fasciaPreferita && `fascia preferita: ${cliente.fasciaPreferita}`,
    cliente.stilistaPreferito && `stilista preferito: ${cliente.stilistaPreferito}`,
    cliente.note && `note: ${cliente.note}`,
  ].filter(Boolean);
  const profilo = [
    `nome: ${cliente.nome || nomeProfilo || 'sconosciuto'}`,
    `telefono: ${cliente.telefono}`,
    !storico ? 'cliente nuovo (nessuna visita registrata)' : `cliente abituale (${storico.n} visite)`,
    `consenso_dati: ${cliente.consensoDati ? 'dato' : 'non ancora dato'}`,
    ...pref,
  ].join('; ');

  const abitudini = !storico
    ? 'Nessuno storico disponibile.'
    : [
        `ultimo servizio: ${storico.ultimoServizio} (${storico.ultimaData})`,
        `servizio abituale: ${storico.servizioAbituale}`,
        storico.giornoAbituale && `giorno abituale: ${storico.giornoAbituale}`,
        `fascia abituale: ${storico.fasciaAbituale}`,
        storico.cadenzaSettimane && `torna in media ogni ${storico.cadenzaSettimane} settimane`,
      ].filter(Boolean).join('; ');

  const proposti = appunt
    .filter((a) => a.stato === 'proposto' && a.inizio.getTime() > now.getTime())
    .sort((a, b) => (a.opzione ?? 0) - (b.opzione ?? 0))
    .map((a) => `Opzione ${a.opzione}: ${etichetta(a.inizio.getTime())} (${a.servizio})`)
    .join(' | ') || 'nessuno';

  const orari = NOMI_GIORNI.map((g) => {
    const f = cfg.orari[g] ?? [];
    return `- ${g}: ${f.length ? f.map((x) => `${x[0]}-${x[1]}`).join(', ') : 'chiuso'}`;
  }).join('\n');

  const serviziTxt = servizi
    .map((s) => `- ${s.nome}: ${s.durataMin} min${s.prezzo != null ? `, ${s.prezzo} euro` : ''}${s.note ? ` (${s.note})` : ''}`)
    .join('\n') || '- (listino non configurato)';

  const conversazione = messaggi.map((m) => `${m.ruolo === 'cliente' ? 'Cliente' : 'Assistente'}: ${m.testo}`).join('\n') || '(prima conversazione)';

  return {
    nome_salone: cfg.nomeSalone, adesso, profilo, abitudini, slot_proposti: proposti,
    servizi: serviziTxt, orari, conversazione,
  };
}
