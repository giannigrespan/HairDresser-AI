// Logica pura (senza dipendenze) usata dai nodi Code di n8n.
// Viene testata con `node --test` e incorporata nei workflow da scripts/build_workflows.js.
// Le funzioni sono volutamente autonome: i nodi Code di n8n non possono fare require di file locali.

const TZ = 'Europe/Rome';
const GIORNI = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];

function tzOffsetMin(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// Ora "a muro" nel fuso indicato -> millisecondi UTC (gestisce l'ora legale).
function localToUtcMs(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - tzOffsetMin(new Date(guess), tz) * 60000;
  const off2 = tzOffsetMin(new Date(ms), tz);
  ms = guess - off2 * 60000;
  return ms;
}

// Data locale (YYYY-MM-DD) di un istante UTC.
function localDateStr(ms, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function etichetta(ms, tz) {
  const giorno = new Intl.DateTimeFormat('it-IT', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ms));
  const ora = new Intl.DateTimeFormat('it-IT', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  return `${giorno} alle ${ora}`;
}

function isoLocale(ms, tz) {
  const off = tzOffsetMin(new Date(ms), tz);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  const hhmm = `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hhmm}`;
}

function parseHM(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
}

// Converte gli eventi Google Calendar in intervalli occupati [startMs, endMs].
function eventiToOccupati(eventi, tz = TZ) {
  const out = [];
  for (const e of eventi || []) {
    if (!e || e.status === 'cancelled' || e.transparency === 'transparent') continue;
    // Il nodo Calendar puo' restituire {dateTime}/{date} oppure stringhe semplificate.
    const norm = (v) => (typeof v === 'string' ? (v.length === 10 ? { date: v } : { dateTime: v }) : v || {});
    const s = norm(e.start);
    const f = norm(e.end);
    if (s.dateTime && f.dateTime) {
      out.push({ start: Date.parse(s.dateTime), end: Date.parse(f.dateTime) });
    } else if (s.date) {
      // Evento "tutto il giorno": blocca l'intera giornata locale.
      const [y, m, d] = s.date.split('-').map(Number);
      const [y2, m2, d2] = (f.date || s.date).split('-').map(Number);
      out.push({
        start: localToUtcMs(y, m, d, 0, 0, tz),
        end: localToUtcMs(y2, m2, d2, 0, 0, tz) + (f.date ? 0 : 24 * 3600000),
      });
    }
  }
  return out;
}

/**
 * Calcola fino a 3 slot liberi.
 * @param {object} p
 *  now (ms UTC), durataMin, bufferMin, orari {lunedi:[["09:00","13:00"],["15:00","19:00"]], domenica:[]},
 *  giorniChiusura ['YYYY-MM-DD'], occupati [{start,end}], preferenze {giorni:['sabato'], fascia:'mattina'|'pomeriggio'},
 *  anticipoMin, orizzonteGiorni, passoMin, tz, n
 */
function calcolaSlot(p) {
  const tz = p.tz || TZ;
  const n = p.n || 3;
  const passo = p.passoMin || 30;
  const durata = p.durataMin + (p.bufferMin || 0);
  const anticipo = (p.anticipoMin ?? 120) * 60000;
  const orizzonte = p.orizzonteGiorni || 21;
  const chiusi = new Set(p.giorniChiusura || []);
  const pref = p.preferenze || {};
  const prefGiorni = (pref.giorni || []).map((g) => g.toLowerCase());
  const occupati = p.occupati || [];

  const oggi = localDateStr(p.now, tz);
  const [y0, m0, d0] = oggi.split('-').map(Number);
  const giorni = []; // { data, slot: [{start,end,score}] }

  for (let i = 0; i <= orizzonte; i++) {
    const base = new Date(Date.UTC(y0, m0 - 1, d0 + i));
    const y = base.getUTCFullYear(); const m = base.getUTCMonth() + 1; const d = base.getUTCDate();
    const dataStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (chiusi.has(dataStr)) continue;
    const nomeGiorno = GIORNI[base.getUTCDay()];
    const fasce = (p.orari || {})[nomeGiorno] || [];
    const candidati = [];
    for (const [apre, chiude] of fasce) {
      for (let t = parseHM(apre); t + durata <= parseHM(chiude); t += passo) {
        const start = localToUtcMs(y, m, d, Math.floor(t / 60), t % 60, tz);
        const end = start + durata * 60000;
        if (start < p.now + anticipo) continue;
        if (occupati.some((o) => start < o.end && end > o.start)) continue;
        let score = 0;
        if (prefGiorni.includes(nomeGiorno)) score += 2;
        if (pref.fascia === 'mattina' && t < 13 * 60) score += 2;
        if (pref.fascia === 'pomeriggio' && t >= 13 * 60) score += 2;
        score -= i * 0.05; // a parita' di preferenze, meglio prima
        candidati.push({ start, end: start + p.durataMin * 60000, score });
      }
    }
    if (candidati.length) giorni.push({ data: dataStr, slot: candidati.sort((a, b) => b.score - a.score || a.start - b.start) });
  }

  // 1) il miglior slot di ciascun giorno, poi i giorni migliori
  const scelti = giorni
    .map((g) => g.slot[0])
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, n);

  // 2) se i giorni disponibili sono meno di n, riempi con altri orari (distanza minima 2h dagli scelti)
  if (scelti.length < n) {
    const extra = giorni.flatMap((g) => g.slot.slice(1))
      .sort((a, b) => b.score - a.score || a.start - b.start);
    for (const c of extra) {
      if (scelti.length >= n) break;
      if (scelti.every((s) => Math.abs(s.start - c.start) >= 2 * 3600000)) scelti.push(c);
    }
  }

  return scelti.sort((a, b) => a.start - b.start).map((s, i) => ({
    n: i + 1,
    inizio: isoLocale(s.start, tz),
    fine: isoLocale(s.end, tz),
    etichetta: etichetta(s.start, tz),
  }));
}

// Dallo storico appuntamenti deduce giorno/fascia preferiti e cadenza media.
function analizzaAbitudini(appuntamenti, tz = TZ) {
  const validi = (appuntamenti || [])
    .filter((a) => a && a.inizio && ['completato', 'confermato'].includes(a.stato))
    .map((a) => ({ ...a, ms: Date.parse(a.inizio) }))
    .filter((a) => !Number.isNaN(a.ms))
    .sort((a, b) => a.ms - b.ms);
  if (!validi.length) return { n: 0 };

  const conta = (arr) => arr.reduce((acc, k) => ((acc[k] = (acc[k] || 0) + 1), acc), {});
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];

  const giorni = validi.map((a) => new Intl.DateTimeFormat('it-IT', { timeZone: tz, weekday: 'long' }).format(new Date(a.ms)));
  const fasce = validi.map((a) => {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(a.ms)));
    return h < 13 ? 'mattina' : 'pomeriggio';
  });
  const servizi = conta(validi.map((a) => a.servizio));

  let cadenzaSettimane = null;
  if (validi.length >= 2) {
    const gap = [];
    for (let i = 1; i < validi.length; i++) gap.push((validi[i].ms - validi[i - 1].ms) / (7 * 86400000));
    cadenzaSettimane = Math.round((gap.reduce((a, b) => a + b, 0) / gap.length) * 10) / 10;
  }
  const [gTop, gN] = top(conta(giorni));
  const [fTop] = top(conta(fasce));
  const [sTop] = top(servizi);
  const ultimo = validi[validi.length - 1];
  return {
    n: validi.length,
    giornoAbituale: gN >= 2 || validi.length === 1 ? gTop : null,
    fasciaAbituale: fTop,
    servizioAbituale: sTop,
    cadenzaSettimane,
    ultimoServizio: ultimo.servizio,
    ultimaData: etichetta(ultimo.ms, tz),
  };
}

function trovaServizio(nomeRichiesto, servizi) {
  const q = String(nomeRichiesto || '').toLowerCase().trim();
  const lista = servizi || [];
  return (
    lista.find((s) => String(s.nome).toLowerCase() === q) ||
    lista.find((s) => String(s.nome).toLowerCase().includes(q) && q) ||
    lista.find((s) => q.includes(String(s.nome).toLowerCase())) ||
    null
  );
}

module.exports = { calcolaSlot, analizzaAbitudini, eventiToOccupati, trovaServizio, localToUtcMs, isoLocale, etichetta, localDateStr, TZ };
