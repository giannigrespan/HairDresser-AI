import { describe, expect, test } from 'vitest';
import * as az from '../lib/actions';
import type { Sessione } from '../lib/actions';
import { loadConfig } from '../lib/config';
import { creaDeps } from './helpers/memory';

const sess = (): Sessione => ({ telefono: '+393401234567', nome: 'Giulia', datiCancellati: false });

async function setup() {
  const ctx = creaDeps();
  const cfg = await loadConfig(ctx.repo);
  return { ...ctx, cfg };
}

describe('proponi_slot', () => {
  test('salva 3 proposte numerate e le restituisce al modello', async () => {
    const { deps, repo, cfg } = await setup();
    const r = await az.proponiSlot(deps, cfg, sess(), { servizio: 'taglio', giorniPreferiti: 'Sabato', fasciaPreferita: 'Mattina' });
    expect(r.ok).toBe(true);
    expect(r.slot).toHaveLength(3);
    const prop = (await repo.appuntamentiCliente('+393401234567')).filter((a) => a.stato === 'proposto');
    expect(prop.map((p) => p.opzione)).toEqual([1, 2, 3]);
    expect(prop.every((p) => p.servizio === 'Taglio')).toBe(true);
    // il taglio dura 45 minuti (il buffer non entra nell'evento)
    expect(prop[0].fine.getTime() - prop[0].inizio.getTime()).toBe(45 * 60000);
  });

  test('una nuova richiesta sostituisce le proposte precedenti', async () => {
    const { deps, repo, cfg } = await setup();
    await az.proponiSlot(deps, cfg, sess(), { servizio: 'Taglio' });
    await az.proponiSlot(deps, cfg, sess(), { servizio: 'Colore' });
    const prop = (await repo.appuntamentiCliente('+393401234567')).filter((a) => a.stato === 'proposto');
    expect(prop).toHaveLength(3);
    expect(prop.every((p) => p.servizio === 'Colore')).toBe(true);
  });

  test('servizio fuori listino -> elenco servizi, nessuna proposta', async () => {
    const { deps, repo, cfg } = await setup();
    const r = await az.proponiSlot(deps, cfg, sess(), { servizio: 'keratina' });
    expect(r).toMatchObject({ ok: false, motivo: 'servizio_non_trovato', serviziDisponibili: ['Taglio', 'Colore'] });
    expect(repo.appunt).toHaveLength(0);
  });

  test('calendario pieno -> nessuna disponibilità', async () => {
    const { deps, calendar, cfg } = await setup();
    calendar.eventi.push({ start: { dateTime: '2026-10-12T00:00:00Z' }, end: { dateTime: '2027-12-31T00:00:00Z' } });
    expect(await az.proponiSlot(deps, cfg, sess(), { servizio: 'Taglio' })).toMatchObject({ ok: false, motivo: 'nessuna_disponibilita' });
  });
});

describe('prenota_appuntamento', () => {
  test('crea l\'evento, conferma la riga e pulisce le altre proposte', async () => {
    const { deps, repo, calendar, cfg } = await setup();
    await az.proponiSlot(deps, cfg, sess(), { servizio: 'Taglio' });
    const r = await az.prenota(deps, cfg, sess(), { opzione: 2 });
    expect(r.ok).toBe(true);
    expect(calendar.creati).toHaveLength(1);
    expect(calendar.creati[0].summary).toBe('Taglio - Giulia');
    const righe = await repo.appuntamentiCliente('+393401234567');
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({ stato: 'confermato', eventId: 'evt1', nomeCliente: 'Giulia' });
  });

  test('slot diventato occupato nel frattempo -> nessun evento creato', async () => {
    const { deps, calendar, cfg } = await setup();
    await az.proponiSlot(deps, cfg, sess(), { servizio: 'Taglio' });
    const [p] = (await deps.repo.appuntamentiCliente('+393401234567'));
    calendar.eventi.push({ start: { dateTime: p.inizio.toISOString() }, end: { dateTime: p.fine.toISOString() } });
    const r = await az.prenota(deps, cfg, sess(), { opzione: p.opzione! });
    expect(r).toMatchObject({ ok: false, motivo: 'slot_occupato' });
    expect(calendar.creati).toHaveLength(0);
  });

  test('opzione inesistente o senza proposte -> errore, nessun evento', async () => {
    const { deps, calendar, cfg } = await setup();
    expect(await az.prenota(deps, cfg, sess(), { opzione: 1 })).toMatchObject({ ok: false });
    await az.proponiSlot(deps, cfg, sess(), { servizio: 'Taglio' });
    expect(await az.prenota(deps, cfg, sess(), { opzione: 9 })).toMatchObject({ ok: false });
    expect(calendar.creati).toHaveLength(0);
  });

  test('un cliente non può confermare le proposte di un altro', async () => {
    const { deps, calendar, cfg } = await setup();
    await az.proponiSlot(deps, cfg, sess(), { servizio: 'Taglio' });
    const altro: Sessione = { telefono: '+393409999999', nome: 'Marco', datiCancellati: false };
    expect(await az.prenota(deps, cfg, altro, { opzione: 1 })).toMatchObject({ ok: false });
    expect(calendar.creati).toHaveLength(0);
  });

  test('proposta scaduta -> rifiutata', async () => {
    const { deps, repo, cfg } = await setup();
    repo.aggiungiAppuntamento({ telefono: '+393401234567', servizio: 'Taglio', inizio: new Date('2026-10-10T08:00:00Z'), stato: 'proposto', opzione: 1 });
    expect(await az.prenota(deps, cfg, sess(), { opzione: 1 })).toMatchObject({ ok: false, motivo: 'slot_scaduto' });
  });
});

describe('salva_preferenza / titolare / cancellazione', () => {
  test('salva solo chiavi ammesse e converte il consenso', async () => {
    const { deps, repo } = await setup();
    await repo.getOrCreateCliente('+393401234567', 'Giulia');
    expect(await az.salvaPreferenza(deps, sess(), { chiave: 'fasciaPreferita', valore: 'mattina' })).toMatchObject({ ok: true });
    expect(await az.salvaPreferenza(deps, sess(), { chiave: 'consensoDati', valore: 'sì' })).toMatchObject({ ok: true });
    expect(repo.clienti.get('+393401234567')).toMatchObject({ fasciaPreferita: 'mattina', consensoDati: true });
    expect(await az.salvaPreferenza(deps, sess(), { chiave: 'nVisite', valore: '99' })).toMatchObject({ ok: false, motivo: 'chiave_non_ammessa' });
    expect(repo.clienti.get('+393401234567')!.nVisite).toBe(0);
  });

  test('avviso alla titolare con testo ripulito', async () => {
    const { deps, whatsapp, cfg } = await setup();
    await az.passaAllaTitolare(deps, cfg, sess(), { motivo: 'Reclamo\n\ngrave   sul colore' });
    expect(whatsapp.template).toEqual([{ to: '+393331112222', name: 'notifica_titolare', params: ['Giulia (+393401234567)', 'Reclamo grave sul colore'] }]);
  });

  test('senza numero della titolare non fallisce', async () => {
    const { deps, repo } = await setup();
    delete repo.kv.telefono_titolare;
    const cfg = await loadConfig(repo);
    expect(await az.passaAllaTitolare(deps, cfg, sess(), { motivo: 'x' })).toMatchObject({ ok: false, motivo: 'titolare_non_configurata' });
  });

  test('cancella tutti i dati del cliente e segnala la sessione', async () => {
    const { deps, repo } = await setup();
    await repo.getOrCreateCliente('+393401234567', 'Giulia');
    repo.aggiungiAppuntamento({ telefono: '+393401234567', servizio: 'Taglio', inizio: new Date(), stato: 'completato' });
    await repo.aggiungiMessaggi([{ telefono: '+393401234567', ruolo: 'cliente', testo: 'ciao', ts: new Date() }]);
    const s = sess();
    await az.cancellaDati(deps, s);
    expect(s.datiCancellati).toBe(true);
    expect([repo.clienti.size, repo.appunt.length, repo.msgs.length]).toEqual([0, 0, 0]);
  });
});

test('config: id_calendario obbligatorio e JSON validi', async () => {
  const { repo } = creaDeps();
  delete repo.kv.id_calendario;
  await expect(loadConfig(repo)).rejects.toThrow(/id_calendario/);
  repo.kv.id_calendario = 'c';
  repo.kv.orari = '{rotto';
  await expect(loadConfig(repo)).rejects.toThrow(/orari/);
});
