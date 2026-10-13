#!/usr/bin/env node
// Sostituisce i segnaposto (__ID_TABELLA_*__, __ID_WORKFLOW_*__, __PHONE_NUMBER_ID__) nei workflow
// usando config.local.json e scrive i file pronti per l'import in dist/.
// Uso: node scripts/configure.js [config.local.json]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cfgPath = path.resolve(process.argv[2] || path.join(root, 'config.local.json'));
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const map = {
  __PHONE_NUMBER_ID__: cfg.phone_number_id,
  __ID_WORKFLOW_SLOT__: cfg.workflow && cfg.workflow.slot,
  __ID_WORKFLOW_AZIONI__: cfg.workflow && cfg.workflow.azioni,
  __ID_WORKFLOW_ERRORI__: cfg.workflow && cfg.workflow.errori,
};
for (const t of ['clienti', 'appuntamenti', 'messaggi', 'servizi', 'impostazioni']) {
  map[`__ID_TABELLA_${t.toUpperCase()}__`] = cfg.tabelle && cfg.tabelle[t];
}

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const rimasti = new Set();
for (const f of fs.readdirSync(path.join(root, 'workflows')).filter((x) => x.endsWith('.json'))) {
  let s = fs.readFileSync(path.join(root, 'workflows', f), 'utf8');
  for (const [k, v] of Object.entries(map)) if (v) s = s.split(k).join(String(v));
  for (const m of s.matchAll(/__[A-Z_]+__/g)) rimasti.add(`${f}: ${m[0]}`);
  fs.writeFileSync(path.join(dist, f), s);
}
console.log('Scritti i workflow configurati in dist/');
if (rimasti.size) console.warn('Segnaposto ancora da compilare in config.local.json:\n  ' + [...rimasti].join('\n  '));
