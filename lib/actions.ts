// Le cinque azioni dell'agente. Il telefono del cliente arriva sempre dal server, mai dal modello.
import type { Deps } from './ports';
import { calcolaSlot, eventiToOccupati, etichetta, normalizzaGiorni, trovaServizio, type Fascia } from './slots';
import type { ChiavePreferenza, ClientePatch, Config } from './types';
import { CHIAVI_PREFERENZA } from './types';

export interface Sessione {
  telefono: string;
  nome: string;
  /** Impostato quando il cliente ha chiesto la cancellazione: l'handler non deve più salvare nulla. */
  datiCancellati: boolean;
}

const pulisci = (s: string, max = 300) => s.replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);

export async function proponiSlot(
  d: Deps, cfg: Config, sess: Sessione,
  a: { servizio: string; giorniPreferiti?: string; fasciaPreferita?: string },
) {
  const servizi = await d.repo.servizi();
  const s = trovaServizio(a.servizio, servizi);
  if (!s) {
    return { ok: false, motivo: 'servizio_non_trovato', serviziDisponibili: servizi.map((x) => x.nome),
      istruzione: 'Servizio non in listino: chiedi al cliente quale tra serviziDisponibili desidera, oppure usa passa_alla_titolare.' };
  }
  const now = d.now().getTime();
  const eventi = await d.calendar.listEvents(cfg.idCalendario, new Date(now), new Date(now + cfg.orizzonteGiorni * 86400000));
  const f = (a.fasciaPreferita ?? '').toLowerCase();
  const fascia: Fascia | null = f.startsWith('matt') ? 'mattina' : f.startsWith('pom') ? 'pomeriggio' : null;
  const slot = calcolaSlot({
    now, durataMin: s.durataMin, bufferMin: s.bufferMin, orari: cfg.orari, giorniChiusura: cfg.giorniChiusura,
    occupati: eventiToOccupati(eventi), preferenze: { giorni: normalizzaGiorni(a.giorniPreferiti), fascia },
    anticipoMin: cfg.anticipoMin, orizzonteGiorni: cfg.orizzonteGiorni, passoMin: cfg.passoMin,
  });
  if (!slot.length) {
    return { ok: false, motivo: 'nessuna_disponibilita', servizio: s.nome,
      istruzione: 'Nessuna disponibilità: scusati e chiedi altri giorni o fasce orarie.' };
  }
  await d.repo.sostituisciProposte(sess.telefono, sess.nome || null,
    slot.map((x) => ({ servizio: s.nome, inizio: new Date(x.inizio), fine: new Date(x.fine), opzione: x.n })));
  return {
    ok: true, servizio: s.nome, slot: slot.map((x) => ({ opzione: x.n, etichetta: x.etichetta })),
    istruzione: 'Presenta al cliente queste opzioni numerate usando il campo etichetta, poi chiedi quale preferisce.',
  };
}

export async function prenota(d: Deps, cfg: Config, sess: Sessione, a: { opzione: number }) {
  // Lock globale: due clienti non possono prenotare lo stesso orario nello stesso istante.
  return d.repo.withLock('prenotazione', async () => {
    const proposte = (await d.repo.appuntamentiCliente(sess.telefono)).filter((x) => x.stato === 'proposto');
    const p = proposte.find((x) => x.opzione === a.opzione);
    if (!p) return { ok: false, motivo: 'opzione_non_valida_o_proposte_scadute', istruzione: 'Richiama proponi_slot per offrire nuove opzioni.' };
    if (p.inizio.getTime() < d.now().getTime()) return { ok: false, motivo: 'slot_scaduto', istruzione: 'Richiama proponi_slot per offrire nuove opzioni.' };

    const eventi = await d.calendar.listEvents(cfg.idCalendario, p.inizio, p.fine);
    const occupato = eventiToOccupati(eventi).some((o) => p.inizio.getTime() < o.end && p.fine.getTime() > o.start);
    if (occupato) return { ok: false, motivo: 'slot_occupato', istruzione: 'Scusati e richiama proponi_slot per offrire nuove opzioni.' };

    const ev = await d.calendar.createEvent(cfg.idCalendario, {
      summary: `${p.servizio} - ${sess.nome || sess.telefono}`,
      description: `Prenotato via WhatsApp\nCliente: ${sess.nome}\nTelefono: ${sess.telefono}`,
      inizio: p.inizio, fine: p.fine,
    });
    await d.repo.confermaProposta(p.id, ev.id, sess.nome || null);
    await d.repo.eliminaProposte(sess.telefono);
    return { ok: true, servizio: p.servizio, quando: etichetta(p.inizio.getTime()), istruzione: 'Conferma al cliente giorno, ora e servizio, ringrazia con calore.' };
  });
}

export async function salvaPreferenza(d: Deps, sess: Sessione, a: { chiave: string; valore: string }) {
  if (!(CHIAVI_PREFERENZA as readonly string[]).includes(a.chiave)) {
    return { ok: false, motivo: 'chiave_non_ammessa', chiaviAmmesse: CHIAVI_PREFERENZA };
  }
  const chiave = a.chiave as ChiavePreferenza;
  const patch: ClientePatch = chiave === 'consensoDati'
    ? { consensoDati: /^(true|si|sì|1|yes)$/i.test(a.valore.trim()) }
    : { [chiave]: pulisci(a.valore, 200) };
  await d.repo.aggiornaCliente(sess.telefono, patch);
  if (chiave === 'nome') sess.nome = pulisci(a.valore, 100);
  return { ok: true, istruzione: 'Preferenza salvata: non serve dirlo al cliente se non è naturale.' };
}

export async function passaAllaTitolare(d: Deps, cfg: Config, sess: Sessione, a: { motivo: string }) {
  if (!cfg.telefonoTitolare) return { ok: false, motivo: 'titolare_non_configurata', istruzione: 'Rassicura comunque il cliente: sarà ricontattato.' };
  await d.whatsapp.sendTemplate(cfg.telefonoTitolare, 'notifica_titolare', [pulisci(`${sess.nome || 'Cliente'} (${sess.telefono})`), pulisci(a.motivo)]);
  return { ok: true, istruzione: 'Titolare avvisata. Rassicura il cliente: sarà ricontattato il prima possibile.' };
}

export async function cancellaDati(d: Deps, sess: Sessione) {
  await d.repo.cancellaDatiCliente(sess.telefono);
  sess.datiCancellati = true;
  return { ok: true, istruzione: 'Conferma al cliente che i suoi dati sono stati cancellati. Non chiamare altri strumenti.' };
}
