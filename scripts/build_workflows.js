#!/usr/bin/env node
// Genera i workflow n8n importabili in workflows/*.json.
// Fonti: src/lib.js (logica incorporata nei nodi Code) e prompts/system_prompt.md.
// Uso: node scripts/build_workflows.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LIB = fs.readFileSync(path.join(root, 'src/lib.js'), 'utf8').replace(/module\.exports[\s\S]*$/, '');
const PROMPT = fs.readFileSync(path.join(root, 'prompts/system_prompt.md'), 'utf8').trim();

// ---------- helper ----------
let counter = 0;
const uid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

class Workflow {
  constructor(name, settings = {}) {
    this.name = name;
    this.nodes = [];
    this.connections = {};
    this.settings = { executionOrder: 'v1', timezone: 'Europe/Rome', ...settings };
  }
  add(name, type, typeVersion, position, parameters = {}, extra = {}) {
    this.nodes.push({ parameters, id: uid(), name, type, typeVersion, position, ...extra });
    return name;
  }
  link(from, to, output = 0, type = 'main') {
    const c = (this.connections[from] ||= {});
    const arr = (c[type] ||= []);
    while (arr.length <= output) arr.push([]);
    arr[output].push({ node: to, type, index: 0 });
  }
  chain(...names) { for (let i = 0; i < names.length - 1; i++) this.link(names[i], names[i + 1]); }
  ai(sub, parent, type) { this.link(sub, parent, 0, type); }
  json() {
    return { name: this.name, nodes: this.nodes, pipeData: {}, connections: this.connections, active: false, settings: this.settings, tags: [] };
  }
}

const TABELLA = (nome) => ({ __rl: true, mode: 'id', value: `__ID_TABELLA_${nome.toUpperCase()}__` });
const filtri = (...conds) => ({
  matchType: 'allConditions',
  filters: { conditions: conds.map(([keyName, keyValue, condition = 'eq']) => ({ keyName, condition, keyValue })) },
});
const dt = (op, tabella, extra = {}) => ({ resource: 'row', operation: op, dataTableId: TABELLA(tabella), ...extra });
const cols = (value) => ({ mappingMode: 'defineBelow', value, matchingColumns: [], schema: [] });
const jsCode = (body) => ({ jsCode: `${LIB}\n// ---- nodo ----\n${body}`, });
const ifBool = (expr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uid(), leftValue: `={{ ${expr} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});
const wa = (phoneExpr, textExpr) => ({
  operation: 'send', phoneNumberId: '__PHONE_NUMBER_ID__', recipientPhoneNumber: phoneExpr, textBody: textExpr,
});
const waTemplate = (phoneExpr, template, params) => ({
  operation: 'sendTemplate', phoneNumberId: '__PHONE_NUMBER_ID__', recipientPhoneNumber: phoneExpr, template,
  components: { component: [{ type: 'body', bodyParameters: { parameter: params.map((text) => ({ type: 'text', text })) } }] },
});
const CAL = (idExpr) => ({ __rl: true, mode: 'id', value: idExpr });

const CONFIG_CODE = `const rows = $input.all().map((i) => i.json);
const kv = {};
for (const r of rows) if (r.chiave) kv[r.chiave] = r.valore;
const j = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const config = {
  nome_salone: kv.nome_salone || 'il nostro salone',
  id_calendario: kv.id_calendario,
  orari: j(kv.orari, {}),
  giorni_chiusura: j(kv.giorni_chiusura, []),
  anticipo_min: Number(kv.anticipo_min || 120),
  orizzonte_giorni: Number(kv.orizzonte_giorni || 21),
  passo_min: Number(kv.passo_min || 30),
  telefono_titolare: kv.telefono_titolare,
};
if (!config.id_calendario) throw new Error("Impostazione 'id_calendario' mancante nella tabella impostazioni");`;

// =====================================================================
// WF3 - Calcolo slot (sub-workflow, chiamato dal tool proponi_slot)
// =====================================================================
function buildSlot() {
  const w = new Workflow('Salone - 03 Calcolo slot');
  w.add('Trigger', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 300], {
    inputSource: 'workflowInputs',
    workflowInputs: { values: ['telefono', 'servizio', 'giorni_preferiti', 'fascia_preferita'].map((name) => ({ name })) },
  });
  w.add('Impostazioni', 'n8n-nodes-base.dataTable', 1, [220, 300], dt('get', 'impostazioni', { returnAll: true }), { executeOnce: true });
  w.add('Config', 'n8n-nodes-base.code', 2, [440, 300], jsCode(`${CONFIG_CODE}\nreturn [{ json: { config } }];`));
  w.add('Servizi', 'n8n-nodes-base.dataTable', 1, [660, 300], dt('get', 'servizi', { returnAll: true }), { executeOnce: true });
  w.add('Servizio', 'n8n-nodes-base.code', 2, [880, 300], jsCode(`const config = $('Config').first().json.config;
const inp = $('Trigger').first().json;
const servizi = $input.all().map((i) => i.json).filter((s) => s.nome);
const s = trovaServizio(inp.servizio, servizi);
if (!s) return [{ json: { ok: false, motivo: 'servizio_non_trovato', servizi_disponibili: servizi.map((x) => x.nome) } }];
return [{ json: { ok: true, config, input: inp, servizio: { nome: s.nome, durata_min: Number(s.durata_min), buffer_min: Number(s.buffer_min || 0) } } }];`));
  w.add('Servizio trovato?', 'n8n-nodes-base.if', 2.2, [1100, 300], ifBool('$json.ok'));
  w.add('Eventi calendario', 'n8n-nodes-base.googleCalendar', 1.3, [1320, 200], {
    resource: 'event', operation: 'getAll', calendar: CAL('={{ $json.config.id_calendario }}'), returnAll: true,
    timeMin: '={{ $now.toISO() }}', timeMax: '={{ $now.plus({ days: $json.config.orizzonte_giorni }).toISO() }}',
    options: { singleEvents: true, orderBy: 'startTime' },
  }, { alwaysOutputData: true });
  w.add('Calcola slot', 'n8n-nodes-base.code', 2, [1540, 200], jsCode(`const d = $('Servizio').first().json;
const eventi = $input.all().map((i) => i.json).filter((e) => e && e.id);
const cfg = d.config;
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').trim();
const giorni = String(d.input.giorni_preferiti || '').split(/[,;]+/).map(norm).filter(Boolean);
const f = norm(String(d.input.fascia_preferita || ''));
const fascia = f.startsWith('matt') ? 'mattina' : f.startsWith('pom') ? 'pomeriggio' : null;
const slot = calcolaSlot({
  now: Date.now(), durataMin: d.servizio.durata_min, bufferMin: d.servizio.buffer_min,
  orari: cfg.orari, giorniChiusura: cfg.giorni_chiusura, occupati: eventiToOccupati(eventi),
  preferenze: { giorni, fascia }, anticipoMin: cfg.anticipo_min, orizzonteGiorni: cfg.orizzonte_giorni, passoMin: cfg.passo_min,
});
return [{ json: { ok: slot.length > 0, motivo: slot.length ? undefined : 'nessuna_disponibilita', servizio: d.servizio, telefono: d.input.telefono, slot } }];`));
  w.add('Ci sono slot?', 'n8n-nodes-base.if', 2.2, [1760, 200], ifBool('$json.ok'));
  w.add('Cancella vecchie proposte', 'n8n-nodes-base.dataTable', 1, [1980, 100],
    dt('deleteRows', 'appuntamenti', filtri(['telefono', "={{ $json.telefono }}"], ['stato', 'proposto'])), { alwaysOutputData: true });
  w.add('Righe proposte', 'n8n-nodes-base.code', 2, [2200, 100], jsCode(`const r = $('Calcola slot').first().json;
return r.slot.map((s) => ({ json: { telefono: r.telefono, servizio: r.servizio.nome, inizio: s.inizio, fine: s.fine, stato: 'proposto', opzione: s.n } }));`));
  w.add('Salva proposte', 'n8n-nodes-base.dataTable', 1, [2420, 100], dt('insert', 'appuntamenti', {
    columns: cols({
      telefono: '={{ $json.telefono }}', servizio: '={{ $json.servizio }}', inizio: '={{ $json.inizio }}',
      fine: '={{ $json.fine }}', stato: '={{ $json.stato }}', opzione: '={{ $json.opzione }}',
    }),
  }));
  w.add('Risposta', 'n8n-nodes-base.code', 2, [2640, 200], jsCode(`const r = $('Calcola slot').first().json;
return [{ json: { ...r, istruzione: r.ok ? 'Presenta al cliente queste opzioni numerate usando il campo etichetta, poi chiedi quale preferisce.' : 'Nessuna disponibilita: scusati e chiedi altri giorni o fasce orarie.' } }];`),
    { executeOnce: true });
  w.add('Errore servizio', 'n8n-nodes-base.code', 2, [1320, 420], jsCode(`const r = $input.first().json;
return [{ json: { ...r, istruzione: 'Servizio non in listino: chiedi al cliente quale tra servizi_disponibili desidera, oppure usa passa_alla_titolare.' } }];`));

  w.chain('Trigger', 'Impostazioni', 'Config', 'Servizi', 'Servizio', 'Servizio trovato?');
  w.link('Servizio trovato?', 'Eventi calendario', 0);
  w.link('Servizio trovato?', 'Errore servizio', 1);
  w.chain('Eventi calendario', 'Calcola slot', 'Ci sono slot?');
  w.link('Ci sono slot?', 'Cancella vecchie proposte', 0);
  w.link('Ci sono slot?', 'Risposta', 1);
  w.chain('Cancella vecchie proposte', 'Righe proposte', 'Salva proposte', 'Risposta');
  return w;
}

// =====================================================================
// WF4 - Azioni dell'agente (prenota / salva preferenza / escalation / cancella dati)
// =====================================================================
function buildAzioni() {
  const w = new Workflow('Salone - 04 Azioni agente');
  w.add('Trigger', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 500], {
    inputSource: 'workflowInputs',
    workflowInputs: { values: ['azione', 'telefono', 'nome', 'opzione', 'chiave', 'valore', 'motivo'].map((name) => ({ name })) },
  });
  w.add('Impostazioni', 'n8n-nodes-base.dataTable', 1, [220, 500], dt('get', 'impostazioni', { returnAll: true }), { executeOnce: true });
  w.add('Config', 'n8n-nodes-base.code', 2, [440, 500], jsCode(`${CONFIG_CODE}\nreturn [{ json: { ...$('Trigger').first().json, config } }];`));
  const rule = (valore) => ({
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: uid(), leftValue: '={{ $json.azione }}', rightValue: valore, operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and',
    },
    renameOutput: true, outputKey: valore,
  });
  w.add('Azione', 'n8n-nodes-base.switch', 3.2, [660, 500], {
    rules: { values: ['prenota', 'salva_preferenza', 'escalation', 'cancella_dati'].map(rule) }, options: {},
  });
  w.link('Config', 'Azione');

  // --- prenota ---
  w.add('Proposte', 'n8n-nodes-base.dataTable', 1, [900, 0],
    dt('get', 'appuntamenti', { returnAll: true, ...filtri(['telefono', '={{ $json.telefono }}'], ['stato', 'proposto']) }), { alwaysOutputData: true });
  w.add('Scegli proposta', 'n8n-nodes-base.code', 2, [1120, 0], jsCode(`const inp = $('Config').first().json;
const righe = $input.all().map((i) => i.json).filter((r) => r.id && r.stato === 'proposto');
const r = righe.find((x) => Number(x.opzione) === Number(inp.opzione));
if (!r) return [{ json: { ok: false, motivo: 'opzione_non_valida_o_proposte_scadute' } }];
const inizio = new Date(r.inizio); const fine = new Date(r.fine);
if (inizio.getTime() < Date.now()) return [{ json: { ok: false, motivo: 'slot_scaduto' } }];
return [{ json: { ok: true, riga: { id: r.id, servizio: r.servizio, inizio: inizio.toISOString(), fine: fine.toISOString() }, config: inp.config, input: { telefono: inp.telefono, nome: inp.nome } } }];`));
  w.add('Proposta valida?', 'n8n-nodes-base.if', 2.2, [1340, 0], ifBool('$json.ok'));
  w.add('Verifica libero', 'n8n-nodes-base.googleCalendar', 1.3, [1560, -80], {
    resource: 'event', operation: 'getAll', calendar: CAL('={{ $json.config.id_calendario }}'), returnAll: true,
    timeMin: '={{ $json.riga.inizio }}', timeMax: '={{ $json.riga.fine }}', options: { singleEvents: true },
  }, { alwaysOutputData: true });
  w.add('Libero?', 'n8n-nodes-base.code', 2, [1780, -80], jsCode(`const d = $('Scegli proposta').first().json;
const ev = $input.all().map((i) => i.json).filter((e) => e && e.id);
const s = Date.parse(d.riga.inizio); const f = Date.parse(d.riga.fine);
const occupato = eventiToOccupati(ev).some((o) => s < o.end && f > o.start);
return [{ json: { ...d, libero: !occupato } }];`));
  w.add('Ancora libero?', 'n8n-nodes-base.if', 2.2, [2000, -80], ifBool('$json.libero'));
  w.add('Crea evento', 'n8n-nodes-base.googleCalendar', 1.3, [2220, -160], {
    resource: 'event', operation: 'create', calendar: CAL('={{ $json.config.id_calendario }}'),
    start: '={{ $json.riga.inizio }}', end: '={{ $json.riga.fine }}',
    additionalFields: {
      summary: "={{ $json.riga.servizio + ' - ' + ($json.input.nome || $json.input.telefono) }}",
      description: "={{ 'Prenotato via WhatsApp\\nCliente: ' + ($json.input.nome || '') + '\\nTelefono: ' + $json.input.telefono }}",
    },
  });
  w.add('Conferma riga', 'n8n-nodes-base.dataTable', 1, [2440, -160], dt('update', 'appuntamenti', {
    ...filtri(['id', "={{ $('Libero?').first().json.riga.id }}"]),
    columns: cols({ stato: 'confermato', event_id: '={{ $json.id }}', nome_cliente: "={{ $('Libero?').first().json.input.nome }}" }),
  }));
  w.add('Pulisci proposte', 'n8n-nodes-base.dataTable', 1, [2660, -160],
    dt('deleteRows', 'appuntamenti', filtri(['telefono', "={{ $('Libero?').first().json.input.telefono }}"], ['stato', 'proposto'])), { alwaysOutputData: true });
  w.add('Esito prenotazione', 'n8n-nodes-base.code', 2, [2880, -160], jsCode(`const d = $('Libero?').first().json;
return [{ json: { ok: true, servizio: d.riga.servizio, quando: etichetta(Date.parse(d.riga.inizio)), istruzione: "Conferma al cliente giorno, ora e servizio, ringrazia con calore." } }];`),
    { executeOnce: true });
  w.add('Esito errore prenotazione', 'n8n-nodes-base.code', 2, [2220, 60], jsCode(`let motivo = 'slot_occupato';
try { const s = $('Scegli proposta').first().json; if (s.ok === false) motivo = s.motivo; } catch (e) {}
return [{ json: { ok: false, motivo, istruzione: 'Scusati e richiama proponi_slot per offrire nuove opzioni.' } }];`),
    { executeOnce: true });
  w.link('Azione', 'Proposte', 0);
  w.chain('Proposte', 'Scegli proposta', 'Proposta valida?');
  w.link('Proposta valida?', 'Verifica libero', 0);
  w.link('Proposta valida?', 'Esito errore prenotazione', 1);
  w.chain('Verifica libero', 'Libero?', 'Ancora libero?');
  w.link('Ancora libero?', 'Crea evento', 0);
  w.link('Ancora libero?', 'Esito errore prenotazione', 1);
  w.chain('Crea evento', 'Conferma riga', 'Pulisci proposte', 'Esito prenotazione');

  // --- salva_preferenza ---
  w.add('Prepara preferenza', 'n8n-nodes-base.code', 2, [900, 300], jsCode(`const inp = $input.first().json;
const consentite = ['nome', 'giorni_preferiti', 'fascia_preferita', 'stilista_preferito', 'note', 'consenso_dati'];
if (!consentite.includes(inp.chiave)) return [{ json: { errore: 'chiave_non_ammessa', chiavi_ammesse: consentite } }];
let v = inp.valore;
if (inp.chiave === 'consenso_dati') v = /^(true|si|sì|1|yes)$/i.test(String(v));
return [{ json: { telefono: inp.telefono, [inp.chiave]: v } }];`));
  w.add('Preferenza valida?', 'n8n-nodes-base.if', 2.2, [1120, 300], ifBool('!!$json.telefono'));
  w.add('Aggiorna cliente', 'n8n-nodes-base.dataTable', 1, [1340, 240], dt('update', 'clienti', {
    ...filtri(['telefono', '={{ $json.telefono }}']), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
  }));
  w.add('Esito preferenza', 'n8n-nodes-base.code', 2, [1560, 300], jsCode(`const p = $('Prepara preferenza').first().json;
return [{ json: p.errore ? { ok: false, ...p } : { ok: true, istruzione: 'Preferenza salvata: non serve dirlo al cliente se non e naturale.' } }];`),
    { executeOnce: true });
  w.link('Azione', 'Prepara preferenza', 1);
  w.chain('Prepara preferenza', 'Preferenza valida?');
  w.link('Preferenza valida?', 'Aggiorna cliente', 0);
  w.link('Preferenza valida?', 'Esito preferenza', 1);
  w.chain('Aggiorna cliente', 'Esito preferenza');

  // --- escalation ---
  w.add('Prepara notifica', 'n8n-nodes-base.code', 2, [900, 560], jsCode(`const d = $input.first().json;
const pulisci = (s) => String(s || '').replace(/[\\n\\r\\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);
return [{ json: { a: String(d.config.telefono_titolare || '').replace('+', ''), cliente: pulisci((d.nome || 'Cliente') + ' (' + d.telefono + ')'), motivo: pulisci(d.motivo) } }];`));
  w.add('Notifica titolare', 'n8n-nodes-base.whatsApp', 1.1, [1120, 560],
    waTemplate('={{ $json.a }}', 'notifica_titolare|it', ['={{ $json.cliente }}', '={{ $json.motivo }}']));
  w.add('Esito escalation', 'n8n-nodes-base.code', 2, [1340, 560], jsCode(`return [{ json: { ok: true, istruzione: 'Titolare avvisata. Rassicura il cliente: sara ricontattato il prima possibile.' } }];`),
    { executeOnce: true });
  w.link('Azione', 'Prepara notifica', 2);
  w.chain('Prepara notifica', 'Notifica titolare', 'Esito escalation');

  // --- cancella_dati (GDPR) ---
  const del = (nome, tab, y) => w.add(nome, 'n8n-nodes-base.dataTable', 1, [900 + (y.x || 0), 800],
    dt('deleteRows', tab, filtri(['telefono', "={{ $('Config').first().json.telefono }}"])), { alwaysOutputData: true });
  del('Cancella messaggi', 'messaggi', { x: 0 });
  del('Cancella appuntamenti', 'appuntamenti', { x: 220 });
  del('Cancella cliente', 'clienti', { x: 440 });
  w.add('Esito cancellazione', 'n8n-nodes-base.code', 2, [1560, 800], jsCode(`return [{ json: { ok: true, istruzione: 'Conferma al cliente che i suoi dati sono stati cancellati. Non chiamare altri strumenti per lui.' } }];`),
    { executeOnce: true });
  w.link('Azione', 'Cancella messaggi', 3);
  w.chain('Cancella messaggi', 'Cancella appuntamenti', 'Cancella cliente', 'Esito cancellazione');
  return w;
}

// =====================================================================
// WF1 - Chat WhatsApp (agente)
// =====================================================================
function buildChat() {
  const w = new Workflow('Salone - 01 Chat WhatsApp', { errorWorkflow: '__ID_WORKFLOW_ERRORI__' });
  w.add('Messaggio WhatsApp', 'n8n-nodes-base.whatsAppTrigger', 1, [0, 300], { updates: ['messages'], options: {} }, { webhookId: uid() });
  w.add('Ha messaggi?', 'n8n-nodes-base.if', 2.2, [220, 300], ifBool('!!$json.messages'));
  w.add('È testo?', 'n8n-nodes-base.if', 2.2, [440, 300], ifBool("$json.messages[0].type === 'text'"));
  w.add('Risposta non testo', 'n8n-nodes-base.whatsApp', 1.1, [660, 480],
    wa("={{ $json.messages[0].from }}", "Grazie per il messaggio 😊 Per ora riesco a leggere solo messaggi scritti: può scrivermi a parole di cosa ha bisogno? Se preferisce, la titolare la ricontatterà appena possibile."));
  w.add('Evita duplicati', 'n8n-nodes-base.removeDuplicates', 2, [660, 240], {
    operation: 'removeItemsSeenInPreviousExecutions', logic: 'removeItemsWithAlreadySeenKeyValues',
    dedupeValue: '={{ $json.messages[0].id }}', options: { historySize: 5000 },
  });
  const set = (name, value) => ({ id: uid(), name, value, type: 'string' });
  w.add('Estrai dati', 'n8n-nodes-base.set', 3.4, [880, 240], {
    assignments: {
      assignments: [
        set('telefono', "={{ '+' + $json.messages[0].from }}"),
        set('nome_profilo', "={{ $json.contacts?.[0]?.profile?.name ?? '' }}"),
        set('testo', '={{ $json.messages[0].text.body }}'),
        set('msg_id', '={{ $json.messages[0].id }}'),
        set('phone_number_id', '={{ $json.metadata.phone_number_id }}'),
      ],
    },
    options: {},
  });
  w.add('Cliente', 'n8n-nodes-base.dataTable', 1, [1100, 240],
    dt('get', 'clienti', { returnAll: false, limit: 1, ...filtri(['telefono', '={{ $json.telefono }}']) }), { alwaysOutputData: true });
  w.add('Cliente esiste?', 'n8n-nodes-base.if', 2.2, [1320, 240], ifBool('$json.id !== undefined && $json.id !== null && $json.id !== ""'));
  w.add('Crea cliente', 'n8n-nodes-base.dataTable', 1, [1540, 340], dt('insert', 'clienti', {
    columns: cols({
      telefono: "={{ $('Estrai dati').first().json.telefono }}", nome: "={{ $('Estrai dati').first().json.nome_profilo }}",
      consenso_dati: false, n_visite: 0, n_no_show: 0,
    }),
  }));
  w.add('Appuntamenti cliente', 'n8n-nodes-base.dataTable', 1, [1760, 240],
    dt('get', 'appuntamenti', { returnAll: true, ...filtri(['telefono', "={{ $('Estrai dati').first().json.telefono }}"]) }), { alwaysOutputData: true, executeOnce: true });
  w.add('Messaggi recenti', 'n8n-nodes-base.dataTable', 1, [1980, 240],
    dt('get', 'messaggi', { returnAll: true, ...filtri(['telefono', "={{ $('Estrai dati').first().json.telefono }}"]) }), { alwaysOutputData: true, executeOnce: true });
  w.add('Impostazioni', 'n8n-nodes-base.dataTable', 1, [2200, 240], dt('get', 'impostazioni', { returnAll: true }), { executeOnce: true });
  w.add('Servizi', 'n8n-nodes-base.dataTable', 1, [2420, 240], dt('get', 'servizi', { returnAll: true }), { executeOnce: true });

  w.add('Contesto', 'n8n-nodes-base.code', 2, [2640, 240], jsCode(`const ex = $('Estrai dati').first().json;
let cliente = {};
try { const c = $('Cliente').first().json; if (c && c.id) cliente = c; } catch (e) {}
if (!cliente.id) { try { cliente = $('Crea cliente').first().json || {}; } catch (e) {} }
const appunt = $('Appuntamenti cliente').all().map((i) => i.json).filter((a) => a.telefono);
const messaggi = $('Messaggi recenti').all().map((i) => i.json).filter((m) => m.testo)
  .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-12);
${CONFIG_CODE.replace('$input.all()', "$('Impostazioni').all()")}
const servizi = $('Servizi').all().map((i) => i.json).filter((s) => s.nome);
const now = Date.now();

const fmtNow = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
const ab = analizzaAbitudini(appunt);
const nuovo = ab.n === 0;
const pref = [
  cliente.giorni_preferiti && 'giorni preferiti: ' + cliente.giorni_preferiti,
  cliente.fascia_preferita && 'fascia preferita: ' + cliente.fascia_preferita,
  cliente.stilista_preferito && 'stilista preferito: ' + cliente.stilista_preferito,
  cliente.note && 'note: ' + cliente.note,
].filter(Boolean);
const profilo = [
  'nome: ' + (cliente.nome || ex.nome_profilo || 'sconosciuto'),
  'telefono: ' + ex.telefono,
  nuovo ? 'cliente nuovo (nessuna visita registrata)' : 'cliente abituale (' + ab.n + ' visite)',
  'consenso_dati: ' + (cliente.consenso_dati ? 'dato' : 'non ancora dato'),
  ...pref,
].join('; ');
const abitudini = nuovo ? 'Nessuno storico disponibile.' : [
  'ultimo servizio: ' + ab.ultimoServizio + ' (' + ab.ultimaData + ')',
  'servizio abituale: ' + ab.servizioAbituale,
  ab.giornoAbituale && 'giorno abituale: ' + ab.giornoAbituale,
  'fascia abituale: ' + ab.fasciaAbituale,
  ab.cadenzaSettimane && 'torna in media ogni ' + ab.cadenzaSettimane + ' settimane',
].filter(Boolean).join('; ');
const proposti = appunt.filter((a) => a.stato === 'proposto' && Date.parse(a.inizio) > now).sort((a, b) => a.opzione - b.opzione)
  .map((a) => 'Opzione ' + a.opzione + ': ' + etichetta(Date.parse(a.inizio)) + ' (' + a.servizio + ')').join(' | ') || 'nessuno';
const giorniNomi = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
const orariTxt = giorniNomi.map((g) => {
  const f = (config.orari || {})[g] || [];
  return '- ' + g + ': ' + (f.length ? f.map((x) => x[0] + '-' + x[1]).join(', ') : 'chiuso');
}).join('\\n');
const serviziTxt = servizi.map((s) => '- ' + s.nome + ': ' + s.durata_min + ' min' + (s.prezzo ? ', ' + s.prezzo + ' euro' : '') + (s.note ? ' (' + s.note + ')' : '')).join('\\n') || '- (listino non configurato)';
const conversazione = messaggi.map((m) => (m.ruolo === 'cliente' ? 'Cliente: ' : 'Assistente: ') + m.testo).join('\\n') || '(prima conversazione)';

return [{ json: {
  telefono: ex.telefono, nome: cliente.nome || ex.nome_profilo || '', testo: ex.testo, phone_number_id: ex.phone_number_id,
  nome_salone: config.nome_salone, adesso: fmtNow, profilo, abitudini, slot_proposti: proposti,
  servizi: serviziTxt, orari: orariTxt, conversazione,
} }];`));

  // Agente
  const sys = '=' + PROMPT.replace(/\{\{(\w+)\}\}/g, (_, k) => `{{ $('Contesto').first().json.${k} }}`);
  w.add('Agente', '@n8n/n8n-nodes-langchain.agent', 2, [2860, 240], {
    promptType: 'define', text: "={{ $('Contesto').first().json.testo }}",
    options: { systemMessage: sys, maxIterations: 8 },
  });
  w.add('Gemini', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, [2760, 480], {
    modelName: 'models/gemini-2.5-flash', options: { temperature: 0.3 },
  });
  w.ai('Gemini', 'Agente', 'ai_languageModel');

  const tel = "={{ $('Contesto').first().json.telefono }}";
  const nome = "={{ $('Contesto').first().json.nome }}";
  const fromAI = (n, d, t = 'string') => `={{ $fromAI('${n}', \`${d}\`, '${t}') }}`;
  const tool = (name, description, wfId, values, pos) => {
    w.add(name, '@n8n/n8n-nodes-langchain.toolWorkflow', 2.2, pos, {
      name, description, workflowId: { __rl: true, mode: 'id', value: wfId },
      workflowInputs: { mappingMode: 'defineBelow', value: values, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    });
    w.ai(name, 'Agente', 'ai_tool');
  };
  tool('proponi_slot',
    'Calcola 3 date/orari liberi in agenda per il servizio richiesto. Usalo SEMPRE prima di proporre un appuntamento. Restituisce gli slot numerati con il campo etichetta da mostrare al cliente.',
    '__ID_WORKFLOW_SLOT__',
    {
      telefono: tel,
      servizio: fromAI('servizio', 'Nome del servizio richiesto, es. Taglio, Colore, Piega'),
      giorni_preferiti: fromAI('giorni_preferiti', 'Giorni preferiti dal cliente separati da virgola (es. sabato, martedi). Vuoto se nessuna preferenza.'),
      fascia_preferita: fromAI('fascia_preferita', 'mattina oppure pomeriggio. Vuoto se nessuna preferenza.'),
    }, [2940, 520]);
  tool('prenota_appuntamento',
    'Conferma e inserisce in agenda uno degli slot gia proposti. Chiamalo SOLO dopo che il cliente ha confermato chiaramente una opzione.',
    '__ID_WORKFLOW_AZIONI__',
    { azione: 'prenota', telefono: tel, nome, opzione: fromAI('opzione', 'Numero (1, 2 o 3) dell\'opzione scelta dal cliente tra gli slot gia proposti', 'number'), chiave: '', valore: '', motivo: '' }, [3140, 520]);
  tool('salva_preferenza',
    'Salva una preferenza stabile del cliente. chiave ammessa: nome, giorni_preferiti, fascia_preferita, stilista_preferito, note, consenso_dati. Mai dati sanitari.',
    '__ID_WORKFLOW_AZIONI__',
    { azione: 'salva_preferenza', telefono: tel, nome, opzione: '', chiave: fromAI('chiave', 'Una tra: nome, giorni_preferiti, fascia_preferita, stilista_preferito, note, consenso_dati'), valore: fromAI('valore', 'Valore da salvare'), motivo: '' }, [3340, 520]);
  tool('passa_alla_titolare',
    'Avvisa la titolare quando serve una persona: reclami, spostamenti entro 24 ore, richieste fuori listino, questioni di salute o dubbi.',
    '__ID_WORKFLOW_AZIONI__',
    { azione: 'escalation', telefono: tel, nome, opzione: '', chiave: '', valore: '', motivo: fromAI('motivo', 'Breve riassunto del motivo, in una frase') }, [3540, 520]);
  tool('cancella_dati_cliente',
    'Cancella definitivamente i dati del cliente (profilo, storico, messaggi) SOLO se lo chiede esplicitamente.',
    '__ID_WORKFLOW_AZIONI__',
    { azione: 'cancella_dati', telefono: tel, nome, opzione: '', chiave: '', valore: '', motivo: '' }, [3740, 520]);

  w.add('Invia risposta', 'n8n-nodes-base.whatsApp', 1.1, [3220, 240],
    wa("={{ $('Contesto').first().json.telefono.replace('+', '') }}", "={{ $('Agente').first().json.output }}"));
  w.add('Prepara log', 'n8n-nodes-base.code', 2, [3440, 240], jsCode(`const c = $('Contesto').first().json;
const t = Date.now();
return [
  { json: { telefono: c.telefono, ruolo: 'cliente', testo: c.testo, ts: new Date(t).toISOString() } },
  { json: { telefono: c.telefono, ruolo: 'assistente', testo: $('Agente').first().json.output, ts: new Date(t + 1000).toISOString() } },
];`));
  w.add('Salva messaggi', 'n8n-nodes-base.dataTable', 1, [3660, 240], dt('insert', 'messaggi', {
    columns: cols({ telefono: '={{ $json.telefono }}', ruolo: '={{ $json.ruolo }}', testo: '={{ $json.testo }}', ts: '={{ $json.ts }}' }),
  }));

  w.link('Messaggio WhatsApp', 'Ha messaggi?');
  w.link('Ha messaggi?', 'È testo?', 0);
  w.link('È testo?', 'Evita duplicati', 0);
  w.link('È testo?', 'Risposta non testo', 1);
  w.chain('Evita duplicati', 'Estrai dati', 'Cliente', 'Cliente esiste?');
  w.link('Cliente esiste?', 'Appuntamenti cliente', 0);
  w.link('Cliente esiste?', 'Crea cliente', 1);
  w.link('Crea cliente', 'Appuntamenti cliente');
  w.chain('Appuntamenti cliente', 'Messaggi recenti', 'Impostazioni', 'Servizi', 'Contesto', 'Agente', 'Invia risposta', 'Prepara log', 'Salva messaggi');
  return w;
}

// =====================================================================
// WF2 - Promemoria, chiusura appuntamenti, pulizia dati
// =====================================================================
function buildPromemoria() {
  const w = new Workflow('Salone - 02 Promemoria e storico');
  w.add('Ogni giorno alle 09:00', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 300], { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * *' }] } });
  w.add('Appuntamenti confermati', 'n8n-nodes-base.dataTable', 1, [220, 300],
    dt('get', 'appuntamenti', { returnAll: true, ...filtri(['stato', 'confermato']) }), { alwaysOutputData: true });

  // Promemoria
  w.add('Da ricordare domani', 'n8n-nodes-base.code', 2, [440, 100], jsCode(`const domani = localDateStr(Date.now() + 24 * 3600000, TZ);
return $input.all().map((i) => i.json)
  .filter((a) => a.id && !a.promemoria_inviato && localDateStr(Date.parse(a.inizio), TZ) === domani)
  .map((a) => ({ json: { id: a.id, a: String(a.telefono).replace('+', ''), nome: a.nome_cliente || 'cliente', quando: etichetta(Date.parse(a.inizio)), servizio: a.servizio } }));`));
  w.add('Invia promemoria', 'n8n-nodes-base.whatsApp', 1.1, [660, 100],
    waTemplate('={{ $json.a }}', 'promemoria_appuntamento|it', ['={{ $json.nome }}', '={{ $json.quando }}', '={{ $json.servizio }}']));
  w.add('Segna promemoria', 'n8n-nodes-base.dataTable', 1, [880, 100], dt('update', 'appuntamenti', {
    ...filtri(['id', "={{ $('Da ricordare domani').item.json.id }}"]), columns: cols({ promemoria_inviato: true }),
  }));

  // Chiusura
  w.add('Da chiudere', 'n8n-nodes-base.code', 2, [440, 340], jsCode(`const now = Date.now();
return $input.all().map((i) => i.json)
  .filter((a) => a.id && Date.parse(a.fine) < now)
  .map((a) => ({ json: { id: a.id, telefono: a.telefono, fine: a.fine } }));`));
  w.add('Segna completato', 'n8n-nodes-base.dataTable', 1, [660, 340], dt('update', 'appuntamenti', {
    ...filtri(['id', '={{ $json.id }}']), columns: cols({ stato: 'completato' }),
  }));
  w.add('Cliente', 'n8n-nodes-base.dataTable', 1, [880, 340],
    dt('get', 'clienti', { returnAll: false, limit: 1, ...filtri(['telefono', "={{ $('Da chiudere').item.json.telefono }}"]) }), { alwaysOutputData: true });
  w.add('Calcola visite', 'n8n-nodes-base.code', 2, [1100, 340], { mode: 'runOnceForEachItem', ...jsCode(`const c = $input.item.json;
const a = $('Da chiudere').item.json;
return { json: { telefono: a.telefono, ok: !!c.id, n_visite: Number(c.n_visite || 0) + 1, ultima_visita: a.fine } };`) });
  w.add('Cliente esiste?', 'n8n-nodes-base.if', 2.2, [1320, 340], ifBool('$json.ok'));
  w.add('Aggiorna cliente', 'n8n-nodes-base.dataTable', 1, [1540, 300], dt('update', 'clienti', {
    ...filtri(['telefono', '={{ $json.telefono }}']), columns: cols({ n_visite: '={{ $json.n_visite }}', ultima_visita: '={{ $json.ultima_visita }}' }),
  }));

  // Pulizia (minimizzazione dati): messaggi piu' vecchi di 30 giorni
  w.add('Pulisci vecchi messaggi', 'n8n-nodes-base.dataTable', 1, [440, 580],
    dt('deleteRows', 'messaggi', filtri(['ts', '={{ $now.minus({ days: 30 }).toISO() }}', 'lt'])), { alwaysOutputData: true });

  w.link('Ogni giorno alle 09:00', 'Appuntamenti confermati');
  w.link('Appuntamenti confermati', 'Da ricordare domani');
  w.link('Appuntamenti confermati', 'Da chiudere');
  w.link('Ogni giorno alle 09:00', 'Pulisci vecchi messaggi');
  w.chain('Da ricordare domani', 'Invia promemoria', 'Segna promemoria');
  w.chain('Da chiudere', 'Segna completato', 'Cliente', 'Calcola visite', 'Cliente esiste?');
  w.link('Cliente esiste?', 'Aggiorna cliente', 0);
  return w;
}

// =====================================================================
// WF5 - Errori
// =====================================================================
function buildErrori() {
  const w = new Workflow('Salone - 05 Avviso errori');
  w.add('Errore', 'n8n-nodes-base.errorTrigger', 1, [0, 0]);
  w.add('Impostazioni', 'n8n-nodes-base.dataTable', 1, [220, 0], dt('get', 'impostazioni', { returnAll: true }), { executeOnce: true });
  w.add('Prepara avviso', 'n8n-nodes-base.code', 2, [440, 0], jsCode(`const kv = {};
for (const r of $input.all().map((i) => i.json)) if (r.chiave) kv[r.chiave] = r.valore;
const e = $('Errore').first().json;
const pulisci = (s) => String(s || '').replace(/[\\n\\r\\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);
return [{ json: {
  a: String(kv.telefono_titolare || '').replace('+', ''),
  cliente: 'Errore automazione (' + pulisci(e.workflow && e.workflow.name) + ')',
  motivo: pulisci(e.execution && e.execution.error && e.execution.error.message),
} }];`));
  w.add('Avvisa titolare', 'n8n-nodes-base.whatsApp', 1.1, [660, 0],
    waTemplate('={{ $json.a }}', 'notifica_titolare|it', ['={{ $json.cliente }}', '={{ $json.motivo }}']));
  w.chain('Errore', 'Impostazioni', 'Prepara avviso', 'Avvisa titolare');
  return w;
}

// ---------- output ----------
const out = path.join(root, 'workflows');
fs.mkdirSync(out, { recursive: true });
const files = {
  '01-chat-whatsapp.json': buildChat(),
  '02-promemoria-storico.json': buildPromemoria(),
  '03-calcolo-slot.json': buildSlot(),
  '04-azioni-agente.json': buildAzioni(),
  '05-avviso-errori.json': buildErrori(),
};
for (const [f, wf] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, f), JSON.stringify(wf.json(), null, 2) + '\n');
  console.log('scritto', path.join('workflows', f), `(${wf.nodes.length} nodi)`);
}
