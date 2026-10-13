import { test } from 'vitest';
import assert from 'node:assert';
import { calcolaSlot, analizzaAbitudini, eventiToOccupati, trovaServizio, localToUtcMs, type Orari } from '../lib/slots';

const orari: Orari = {
  lunedi: [], martedi: [['09:00', '13:00'], ['15:00', '19:00']], mercoledi: [['09:00', '13:00'], ['15:00', '19:00']],
  giovedi: [['09:00', '13:00'], ['15:00', '19:00']], venerdi: [['09:00', '13:00'], ['15:00', '19:00']],
  sabato: [['09:00', '17:00']], domenica: [],
};
// Lunedi 12 ottobre 2026, 10:00 a Roma (ora legale, UTC+2)
const NOW = localToUtcMs(2026, 10, 12, 10, 0, 'Europe/Rome');
const base = { now: NOW, durataMin: 60, bufferMin: 0, orari, giorniChiusura: [], occupati: [], anticipoMin: 120, orizzonteGiorni: 14 };

test('restituisce 3 slot su giorni diversi, mai in giorni di chiusura', () => {
  const r = calcolaSlot(base);
  assert.strictEqual(r.length, 3);
  const giorni = new Set(r.map((s) => s.inizio.slice(0, 10)));
  assert.strictEqual(giorni.size, 3);
  r.forEach((s) => assert.ok(!s.etichetta.startsWith('lunedì') && !s.etichetta.startsWith('domenica')));
});

test('rispetta preferenza giorno e fascia', () => {
  const r = calcolaSlot({ ...base, preferenze: { giorni: ['sabato'], fascia: 'mattina' } });
  assert.ok(r[0].etichetta.startsWith('sabato') || r.some((s) => s.etichetta.startsWith('sabato')));
  const sab = r.find((s) => s.etichetta.startsWith('sabato'))!;
  assert.ok(sab.inizio.includes('T09:00') || sab.inizio.includes('T1')); // mattina
});

test('non propone slot che si sovrappongono a eventi o con anticipo insufficiente', () => {
  // Martedi 13 occupato tutto il giorno
  const occ = eventiToOccupati([{ start: { date: '2026-10-13' }, end: { date: '2026-10-14' } }]);
  const r = calcolaSlot({ ...base, occupati: occ });
  assert.ok(r.every((s) => !s.inizio.startsWith('2026-10-13')));
  const r2 = calcolaSlot({ ...base, now: localToUtcMs(2026, 10, 13, 8, 30, 'Europe/Rome'), anticipoMin: 120 });
  assert.ok(r2.every((s) => s.inizio >= '2026-10-13T10:30'));
});

test('il buffer riduce gli slot ma la fine evento esclude il buffer', () => {
  const r = calcolaSlot({ ...base, durataMin: 120, bufferMin: 30 });
  r.forEach((s) => assert.strictEqual((Date.parse(s.fine) - Date.parse(s.inizio)) / 60000, 120));
});

test('se i giorni liberi sono meno di 3 riempie con altri orari lontani almeno 2h', () => {
  const r = calcolaSlot({ ...base, orizzonteGiorni: 1 }); // solo martedi 13 (oggi lunedi chiuso)
  assert.strictEqual(r.length, 3);
  const t = r.map((s) => Date.parse(s.inizio));
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 2 * 3600000);
});

test('nessuna disponibilita -> lista vuota', () => {
  assert.deepStrictEqual(calcolaSlot({ ...base, durataMin: 600 }), []);
});

test('gestisce il cambio ora legale (25 ottobre 2026)', () => {
  const now = localToUtcMs(2026, 10, 24, 8, 0, 'Europe/Rome');
  const r = calcolaSlot({ ...base, now, preferenze: { giorni: ['martedi'] } });
  const mar = r.find((s) => s.inizio.startsWith('2026-10-27'));
  if (mar) assert.ok(mar.inizio.endsWith('+01:00')); // dopo il cambio: CET
});

test('abitudini da storico', () => {
  const ab = analizzaAbitudini([
    { inizio: '2026-08-01T08:00:00Z', servizio: 'Taglio e piega', stato: 'completato' },
    { inizio: '2026-09-05T08:30:00Z', servizio: 'Taglio e piega', stato: 'completato' },
    { inizio: '2026-10-10T08:00:00Z', servizio: 'Colore', stato: 'completato' },
    { inizio: '2026-10-11T08:00:00Z', servizio: 'Colore', stato: 'annullato' },
  ]);
  assert.strictEqual(ab.n, 3);
  assert.strictEqual(ab.giornoAbituale, 'sabato');
  assert.strictEqual(ab.fasciaAbituale, 'mattina');
  assert.strictEqual(ab.servizioAbituale, 'Taglio e piega');
  assert.ok(ab.n > 0 && ab.cadenzaSettimane! > 4 && ab.cadenzaSettimane! < 6);
  assert.deepStrictEqual(analizzaAbitudini([]), { n: 0 });
});

test('trovaServizio e match approssimato', () => {
  const s = [{ nome: 'Taglio' }, { nome: 'Colore' }, { nome: 'Piega' }];
  assert.strictEqual(trovaServizio('colore', s)!.nome, 'Colore');
  assert.strictEqual(trovaServizio('vorrei fare un taglio', s)!.nome, 'Taglio');
  assert.strictEqual(trovaServizio('keratina', s), null);
});
