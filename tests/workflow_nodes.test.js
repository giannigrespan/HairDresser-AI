// Esegue i nodi Code dei workflow con un mock minimale dell'ambiente n8n ($input, $('Nodo'), $json).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const wf = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows', f), 'utf8'));
const items = (arr) => arr.map((json) => ({ json }));

// Esegue il nodo `nome` del workflow `file`. `nodi` = { 'Nome nodo': [json, ...] } per $('Nome nodo').
async function run(file, nome, input, nodi = {}) {
  const node = wf(file).nodes.find((n) => n.name === nome);
  assert.ok(node, `nodo ${nome} non trovato`);
  const lookup = (n) => {
    if (!(n in nodi)) throw new Error(`Nodo ${n} non eseguito`);
    const it = items(nodi[n]);
    return { first: () => it[0], all: () => it, item: it[0] };
  };
  const inp = items(input);
  const $input = { all: () => inp, first: () => inp[0], item: inp[0] };
  const fn = new AsyncFunction('$input', '$', '$json', '$now', node.parameters.jsCode);
  const r = await fn($input, lookup, inp[0] && inp[0].json, new Date());
  return r.map((x) => x.json);
}

const settings = items([
  { chiave: 'nome_salone', valore: 'Salone Bella' },
  { chiave: 'id_calendario', valore: 'cal@group.calendar.google.com' },
  { chiave: 'orari', valore: JSON.stringify({ lunedi: [], martedi: [['09:00', '19:00']], mercoledi: [['09:00', '19:00']], giovedi: [['09:00', '19:00']], venerdi: [['09:00', '19:00']], sabato: [['09:00', '17:00']], domenica: [] }) },
  { chiave: 'giorni_chiusura', valore: '[]' },
  { chiave: 'telefono_titolare', valore: '+393331112222' },
]).map((x) => x.json);
const servizi = [
  { nome: 'Taglio', durata_min: 45, buffer_min: 15, prezzo: 25 },
  { nome: 'Colore', durata_min: 120, buffer_min: 0, prezzo: 60, note: 'ricrescita' },
];

test('WF3: Config -> Servizio -> Calcola slot restituisce 3 slot', async () => {
  const [{ config }] = await run('03-calcolo-slot.json', 'Config', settings);
  assert.strictEqual(config.nome_salone, 'Salone Bella');
  const trigger = { telefono: '+393401234567', servizio: 'taglio', giorni_preferiti: 'Sabato, martedì', fascia_preferita: 'Mattina' };
  const [sv] = await run('03-calcolo-slot.json', 'Servizio', servizi, { Config: [{ config }], Trigger: [trigger] });
  assert.ok(sv.ok);
  assert.strictEqual(sv.servizio.durata_min, 45);
  const evento = { id: 'e1', start: { dateTime: new Date(Date.now() + 3 * 86400000).toISOString() }, end: { dateTime: new Date(Date.now() + 3 * 86400000 + 3600000).toISOString() } };
  const [out] = await run('03-calcolo-slot.json', 'Calcola slot', [evento], { Servizio: [sv] });
  assert.ok(out.ok);
  assert.strictEqual(out.slot.length, 3);
  assert.strictEqual(out.telefono, '+393401234567');
  const [righe] = [await run('03-calcolo-slot.json', 'Righe proposte', [{}], { 'Calcola slot': [out] })];
  assert.strictEqual(righe.length, 3);
  assert.deepStrictEqual(righe.map((r) => r.opzione), [1, 2, 3]);
  assert.ok(righe.every((r) => r.stato === 'proposto' && r.servizio === 'Taglio'));
});

test('WF3: servizio sconosciuto -> elenco servizi', async () => {
  const [{ config }] = await run('03-calcolo-slot.json', 'Config', settings);
  const [sv] = await run('03-calcolo-slot.json', 'Servizio', servizi, { Config: [{ config }], Trigger: [{ servizio: 'cheratina' }] });
  assert.strictEqual(sv.ok, false);
  assert.deepStrictEqual(sv.servizi_disponibili, ['Taglio', 'Colore']);
});

test('WF3: impostazione calendario mancante -> errore esplicito', async () => {
  await assert.rejects(run('03-calcolo-slot.json', 'Config', [{ chiave: 'nome_salone', valore: 'X' }]), /id_calendario/);
});

test('WF1: Contesto per cliente abituale con slot proposti', async () => {
  const futuro = new Date(Date.now() + 2 * 86400000).toISOString();
  const nodi = {
    'Estrai dati': [{ telefono: '+393401234567', nome_profilo: 'Giulia', testo: 'Vorrei prenotare', phone_number_id: '1' }],
    Cliente: [{ id: 7, telefono: '+393401234567', nome: 'Giulia', giorni_preferiti: 'sabato', consenso_dati: true }],
    'Appuntamenti cliente': [
      { telefono: '+393401234567', servizio: 'Taglio', inizio: '2026-08-01T08:00:00Z', fine: '2026-08-01T09:00:00Z', stato: 'completato' },
      { telefono: '+393401234567', servizio: 'Taglio', inizio: '2026-09-05T08:00:00Z', fine: '2026-09-05T09:00:00Z', stato: 'completato' },
      { telefono: '+393401234567', servizio: 'Taglio', inizio: futuro, fine: futuro, stato: 'proposto', opzione: 1 },
    ],
    'Messaggi recenti': [
      { ruolo: 'assistente', testo: 'Buongiorno!', ts: '2026-10-12T09:00:01Z' },
      { ruolo: 'cliente', testo: 'Ciao', ts: '2026-10-12T09:00:00Z' },
    ],
    Impostazioni: settings,
    Servizi: servizi,
  };
  const [ctx] = await run('01-chat-whatsapp.json', 'Contesto', [{}], nodi);
  assert.strictEqual(ctx.nome_salone, 'Salone Bella');
  assert.match(ctx.profilo, /cliente abituale \(2 visite\)/);
  assert.match(ctx.profilo, /giorni preferiti: sabato/);
  assert.match(ctx.abitudini, /servizio abituale: Taglio/);
  assert.match(ctx.slot_proposti, /Opzione 1:/);
  assert.match(ctx.servizi, /Colore: 120 min, 60 euro \(ricrescita\)/);
  assert.match(ctx.orari, /lunedi: chiuso/);
  assert.ok(ctx.conversazione.indexOf('Cliente: Ciao') < ctx.conversazione.indexOf('Assistente: Buongiorno!'));
});

test('WF1: Contesto per cliente nuovo appena creato', async () => {
  const nodi = {
    'Estrai dati': [{ telefono: '+393409999999', nome_profilo: 'Marco', testo: 'Ciao', phone_number_id: '1' }],
    Cliente: [{}], 'Crea cliente': [{ id: 1, telefono: '+393409999999', nome: 'Marco' }],
    'Appuntamenti cliente': [{}], 'Messaggi recenti': [{}], Impostazioni: settings, Servizi: servizi,
  };
  const [ctx] = await run('01-chat-whatsapp.json', 'Contesto', [{}], nodi);
  assert.match(ctx.profilo, /cliente nuovo/);
  assert.match(ctx.profilo, /consenso_dati: non ancora dato/);
  assert.strictEqual(ctx.slot_proposti, 'nessuno');
  assert.strictEqual(ctx.conversazione, '(prima conversazione)');
});

test('WF4: Scegli proposta, rifiuta opzioni inesistenti e slot scaduti', async () => {
  const futuro = (h) => new Date(Date.now() + h * 3600000).toISOString();
  const righe = [
    { id: 1, stato: 'proposto', opzione: 1, servizio: 'Taglio', inizio: futuro(48), fine: futuro(49) },
    { id: 2, stato: 'proposto', opzione: 2, servizio: 'Taglio', inizio: futuro(-5), fine: futuro(-4) },
  ];
  const cfg = { Config: [{ telefono: '+39340', nome: 'Giulia', opzione: 1, config: { id_calendario: 'c' } }] };
  const [ok] = await run('04-azioni-agente.json', 'Scegli proposta', righe, cfg);
  assert.ok(ok.ok); assert.strictEqual(ok.riga.id, 1);
  const [no] = await run('04-azioni-agente.json', 'Scegli proposta', righe, { Config: [{ ...cfg.Config[0], opzione: 3 }] });
  assert.strictEqual(no.ok, false);
  const [scaduto] = await run('04-azioni-agente.json', 'Scegli proposta', righe, { Config: [{ ...cfg.Config[0], opzione: 2 }] });
  assert.strictEqual(scaduto.motivo, 'slot_scaduto');
});

test('WF4: Libero? rileva sovrapposizione al momento della prenotazione', async () => {
  const d = { ok: true, riga: { id: 1, inizio: '2026-11-03T09:00:00.000Z', fine: '2026-11-03T10:00:00.000Z' }, input: {} };
  const occupato = { id: 'x', start: { dateTime: '2026-11-03T09:30:00Z' }, end: { dateTime: '2026-11-03T10:30:00Z' } };
  const [r1] = await run('04-azioni-agente.json', 'Libero?', [occupato], { 'Scegli proposta': [d] });
  assert.strictEqual(r1.libero, false);
  const [r2] = await run('04-azioni-agente.json', 'Libero?', [{}], { 'Scegli proposta': [d] });
  assert.strictEqual(r2.libero, true);
});

test('WF4: Prepara preferenza accetta solo chiavi ammesse', async () => {
  const [ok] = await run('04-azioni-agente.json', 'Prepara preferenza', [{ telefono: '+39', chiave: 'fascia_preferita', valore: 'mattina' }]);
  assert.deepStrictEqual(ok, { telefono: '+39', fascia_preferita: 'mattina' });
  const [consenso] = await run('04-azioni-agente.json', 'Prepara preferenza', [{ telefono: '+39', chiave: 'consenso_dati', valore: 'sì' }]);
  assert.strictEqual(consenso.consenso_dati, true);
  const [no] = await run('04-azioni-agente.json', 'Prepara preferenza', [{ telefono: '+39', chiave: 'id', valore: '1' }]);
  assert.strictEqual(no.errore, 'chiave_non_ammessa');
});

test('WF4: notifica titolare ripulisce newline e numero', async () => {
  const [n] = await run('04-azioni-agente.json', 'Prepara notifica', [{ nome: 'Giulia', telefono: '+39340', motivo: 'Reclamo\n\ngrave', config: { telefono_titolare: '+393331112222' } }]);
  assert.strictEqual(n.a, '393331112222');
  assert.ok(!/\n/.test(n.motivo));
});

test('WF2: promemoria solo per domani e non gia inviati; chiusura per passati', async () => {
  const domani = new Date(Date.now() + 24 * 3600000);
  const ieri = new Date(Date.now() - 24 * 3600000);
  const rows = [
    { id: 1, telefono: '+39', nome_cliente: 'Giulia', servizio: 'Taglio', inizio: domani.toISOString(), fine: new Date(domani.getTime() + 3600000).toISOString(), stato: 'confermato' },
    { id: 2, telefono: '+39', servizio: 'Taglio', inizio: domani.toISOString(), fine: domani.toISOString(), stato: 'confermato', promemoria_inviato: true },
    { id: 3, telefono: '+39', servizio: 'Colore', inizio: ieri.toISOString(), fine: new Date(ieri.getTime() + 3600000).toISOString(), stato: 'confermato' },
  ];
  const rem = await run('02-promemoria-storico.json', 'Da ricordare domani', rows);
  assert.deepStrictEqual(rem.map((r) => r.id), [1]);
  const chiudi = await run('02-promemoria-storico.json', 'Da chiudere', rows);
  assert.deepStrictEqual(chiudi.map((r) => r.id), [3]);
});

test('Prompt: tutti i segnaposto sono risolti nell\'agente', () => {
  const agente = wf('01-chat-whatsapp.json').nodes.find((n) => n.name === 'Agente');
  const sys = agente.parameters.options.systemMessage;
  assert.ok(sys.startsWith('='));
  assert.ok(!/\{\{\w+\}\}/.test(sys), 'segnaposto {{x}} non sostituiti');
  for (const k of ['nome_salone', 'adesso', 'profilo', 'abitudini', 'slot_proposti', 'conversazione', 'servizi', 'orari']) {
    assert.ok(sys.includes(`$('Contesto').first().json.${k}`), `manca ${k}`);
  }
});
