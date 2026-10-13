#!/usr/bin/env node
// Controlli statici sui workflow generati: nomi unici, connessioni valide, nodi Code compilabili,
// placeholder da sostituire elencati. Uso: node scripts/validate_workflows.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'workflows');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let errori = 0;
const placeholders = new Set();
const fail = (m) => { errori++; console.error('ERRORE', m); };

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const names = new Set();
  for (const n of wf.nodes) {
    if (names.has(n.name)) fail(`${f}: nome duplicato "${n.name}"`);
    names.add(n.name);
    if (n.type === 'n8n-nodes-base.code') {
      try { new AsyncFunction('$input', '$', '$json', '$now', n.parameters.jsCode); } catch (e) { fail(`${f}/${n.name}: ${e.message}`); }
    }
  }
  for (const [da, tipi] of Object.entries(wf.connections)) {
    if (!names.has(da)) fail(`${f}: connessione da nodo inesistente "${da}"`);
    for (const rami of Object.values(tipi)) for (const ramo of rami) for (const c of ramo) {
      if (!names.has(c.node)) fail(`${f}: connessione verso nodo inesistente "${c.node}"`);
    }
  }
  const trigger = wf.nodes.filter((n) => /Trigger$/i.test(n.type)).length;
  if (trigger !== 1) fail(`${f}: attesi 1 trigger, trovati ${trigger}`);
  for (const m of JSON.stringify(wf).matchAll(/__[A-Z_]+__/g)) placeholders.add(m[0]);
  console.log(`ok ${f}: ${wf.nodes.length} nodi`);
}
console.log('\nPlaceholder da sostituire (vedi scripts/configure.js):\n  ' + [...placeholders].sort().join('\n  '));
process.exit(errori ? 1 : 0);
