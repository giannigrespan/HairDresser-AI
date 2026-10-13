import { describe, expect, test } from 'vitest';
import { loadConfig } from '../lib/config';
import { buildContesto } from '../lib/context';
import { gestisciMessaggio, RISPOSTA_ERRORE, RISPOSTA_NON_TESTO } from '../lib/handler';
import { renderPrompt, leggiTemplate } from '../lib/prompt';
import { creaStrumenti } from '../lib/tools';
import type { MessaggioInArrivo } from '../lib/whatsapp';
import { ADESSO, creaDeps } from './helpers/memory';

const msg = (over: Partial<MessaggioInArrivo> = {}): MessaggioInArrivo => ({
  id: 'wamid.1', telefono: '+393401234567', nome: 'Giulia', tipo: 'text', testo: 'Vorrei prenotare', ...over,
});

describe('prompt e contesto', () => {
  test('cliente abituale: profilo, abitudini, proposte, listino, orari, conversazione', async () => {
    const { repo } = creaDeps();
    const c = await repo.getOrCreateCliente('+393401234567', 'Giulia');
    c.giorniPreferiti = 'sabato';
    for (const inizio of ['2026-08-01T08:00:00Z', '2026-09-05T08:00:00Z']) {
      repo.aggiungiAppuntamento({ telefono: c.telefono, servizio: 'Taglio', inizio: new Date(inizio), stato: 'completato' });
    }
    repo.aggiungiAppuntamento({ telefono: c.telefono, servizio: 'Taglio', inizio: new Date('2026-10-17T07:00:00Z'), stato: 'proposto', opzione: 1 });
    await repo.aggiungiMessaggi([
      { telefono: c.telefono, ruolo: 'cliente', testo: 'Ciao', ts: new Date('2026-10-11T09:00:00Z') },
      { telefono: c.telefono, ruolo: 'assistente', testo: 'Buongiorno!', ts: new Date('2026-10-11T09:00:01Z') },
    ]);
    const cfg = await loadConfig(repo);
    const v = await buildContesto(repo, cfg, c, 'Giulia', ADESSO);
    expect(v.profilo).toMatch(/cliente abituale \(2 visite\)/);
    expect(v.profilo).toMatch(/giorni preferiti: sabato/);
    expect(v.abitudini).toMatch(/servizio abituale: Taglio/);
    expect(v.slot_proposti).toMatch(/Opzione 1:/);
    expect(v.servizi).toMatch(/Colore: 120 min, 60 euro \(ricrescita\)/);
    expect(v.orari).toMatch(/lunedi: chiuso/);
    expect(v.conversazione).toBe('Cliente: Ciao\nAssistente: Buongiorno!');
    const system = renderPrompt(v);
    expect(system).not.toMatch(/\{\{\w+\}\}/);
    expect(system).toContain('Salone Bella');
  });

  test('cliente nuovo', async () => {
    const { repo } = creaDeps();
    const c = await repo.getOrCreateCliente('+393409999999', 'Marco');
    const v = await buildContesto(repo, await loadConfig(repo), c, 'Marco', ADESSO);
    expect(v.profilo).toMatch(/cliente nuovo/);
    expect(v.profilo).toMatch(/consenso_dati: non ancora dato/);
    expect(v.slot_proposti).toBe('nessuno');
    expect(v.conversazione).toBe('(prima conversazione)');
  });

  test('il template usa solo segnaposto che il contesto fornisce', async () => {
    const { repo } = creaDeps();
    const c = await repo.getOrCreateCliente('+39', 'x');
    const v = await buildContesto(repo, await loadConfig(repo), c, 'x', ADESSO);
    const usati = [...leggiTemplate().matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    for (const k of usati) expect(Object.keys(v), `manca ${k}`).toContain(k);
  });

  test('gli strumenti esposti al modello non accettano mai il telefono', async () => {
    const { deps, repo } = creaDeps();
    const t = creaStrumenti(deps, await loadConfig(repo), { telefono: '+39', nome: '', datiCancellati: false });
    expect(Object.keys(t).sort()).toEqual(['cancella_dati_cliente', 'passa_alla_titolare', 'prenota_appuntamento', 'proponi_slot', 'salva_preferenza']);
    for (const x of Object.values(t)) expect(JSON.stringify(x.inputSchema)).not.toMatch(/telefono/i);
  });
});

describe('gestisciMessaggio', () => {
  test('risponde, crea il cliente e salva i due messaggi', async () => {
    const { deps, repo, whatsapp } = creaDeps({ agent: async ({ text }) => `Risposta a: ${text}` });
    expect(await gestisciMessaggio(deps, msg())).toBe('risposto');
    expect(whatsapp.testi).toEqual([{ to: '+393401234567', body: 'Risposta a: Vorrei prenotare' }]);
    expect(repo.clienti.get('+393401234567')?.nome).toBe('Giulia');
    expect(repo.msgs.map((m) => m.ruolo)).toEqual(['cliente', 'assistente']);
  });

  test('stesso message_id (ritentativo di Meta) -> ignorato, nessuna doppia risposta', async () => {
    const { deps, whatsapp } = creaDeps();
    await gestisciMessaggio(deps, msg());
    expect(await gestisciMessaggio(deps, msg())).toBe('ignorato');
    expect(whatsapp.testi).toHaveLength(1);
  });

  test('messaggio non testuale -> risposta fissa, agente non chiamato', async () => {
    let chiamato = false;
    const { deps, whatsapp } = creaDeps({ agent: async () => { chiamato = true; return 'x'; } });
    await gestisciMessaggio(deps, msg({ tipo: 'audio', testo: null }));
    expect(chiamato).toBe(false);
    expect(whatsapp.testi[0].body).toBe(RISPOSTA_NON_TESTO);
  });

  test('errore del modello -> scuse al cliente e avviso alla titolare', async () => {
    const { deps, whatsapp, repo } = creaDeps({ agent: async () => { throw new Error('quota'); } });
    expect(await gestisciMessaggio(deps, msg())).toBe('errore');
    expect(whatsapp.testi[0].body).toBe(RISPOSTA_ERRORE);
    expect(whatsapp.template[0]).toMatchObject({ to: '+393331112222', name: 'notifica_titolare' });
    expect(repo.msgs).toHaveLength(0);
  });

  test('impostazioni mancanti -> errore senza eccezioni verso il chiamante', async () => {
    const { deps, repo } = creaDeps();
    delete repo.kv.id_calendario;
    expect(await gestisciMessaggio(deps, msg())).toBe('errore');
  });

  test('flusso completo: proposta, scelta, prenotazione con strumenti reali', async () => {
    const { deps, calendar, repo, whatsapp } = creaDeps({
      agent: async ({ tools, text }) => {
        const t = tools as any;
        if (/prenotare/.test(text)) {
          const r = await t.proponi_slot.execute({ servizio: 'Taglio' }, {});
          return `Ecco le opzioni: ${r.slot.map((s: any) => `${s.opzione}) ${s.etichetta}`).join(', ')}`;
        }
        const r = await t.prenota_appuntamento.execute({ opzione: 2 }, {});
        return r.ok ? `Prenotato ${r.quando}` : 'errore';
      },
    });
    await gestisciMessaggio(deps, msg({ id: 'a', testo: 'Vorrei prenotare un taglio' }));
    expect(whatsapp.testi[0].body).toMatch(/1\) .*2\) .*3\) /);
    await gestisciMessaggio(deps, msg({ id: 'b', testo: 'La seconda' }));
    expect(whatsapp.testi[1].body).toMatch(/^Prenotato /);
    expect(calendar.creati).toHaveLength(1);
    expect((await repo.appuntamentiCliente('+393401234567')).map((a) => a.stato)).toEqual(['confermato']);
  });

  test('dopo la cancellazione dati il messaggio non viene salvato di nuovo', async () => {
    const { deps, repo, whatsapp } = creaDeps({
      agent: async ({ tools }) => { await (tools as any).cancella_dati_cliente.execute({}, {}); return 'Dati cancellati.'; },
    });
    await gestisciMessaggio(deps, msg({ testo: 'Cancella i miei dati' }));
    expect(whatsapp.testi[0].body).toBe('Dati cancellati.');
    expect(repo.msgs).toHaveLength(0);
    expect(repo.clienti.size).toBe(0);
  });

  test('due messaggi dello stesso cliente vengono elaborati in serie', async () => {
    const ordine: string[] = [];
    const { deps } = creaDeps({
      agent: async ({ text }) => { ordine.push(`inizio ${text}`); await new Promise((r) => setTimeout(r, 20)); ordine.push(`fine ${text}`); return 'ok'; },
    });
    await Promise.all([gestisciMessaggio(deps, msg({ id: '1', testo: 'A' })), gestisciMessaggio(deps, msg({ id: '2', testo: 'B' }))]);
    expect(ordine).toEqual(['inizio A', 'fine A', 'inizio B', 'fine B']);
  });
});
