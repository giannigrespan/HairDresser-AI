// Logica pura (senza I/O): calcolo slot liberi e analisi delle abitudini dei clienti.
// Tutte le date sono millisecondi UTC o stringhe ISO; il fuso del salone è Europe/Rome.

export const TZ = 'Europe/Rome';
const GIORNI = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'] as const;

export type Fascia = 'mattina' | 'pomeriggio';
export type Orari = Partial<Record<(typeof GIORNI)[number], [string, string][]>>;
export interface Intervallo { start: number; end: number }
export interface Slot { n: number; inizio: string; fine: string; etichetta: string }
export interface GoogleEvent {
  status?: string;
  transparency?: string;
  start?: string | { date?: string; dateTime?: string };
  end?: string | { date?: string; dateTime?: string };
}

const fmtParts = (ms: number, tz: string, opts: Intl.DateTimeFormatOptions, locale = 'en-US') =>
  Object.fromEntries(new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));

function tzOffsetMin(ms: number, tz: string): number {
  const p = fmtParts(ms, tz, { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Ora "a muro" nel fuso indicato -> ms UTC (gestisce l'ora legale). */
export function localToUtcMs(y: number, m: number, d: number, hh: number, mm: number, tz = TZ): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffsetMin(guess, tz) * 60000;
  return guess - tzOffsetMin(first, tz) * 60000;
}

/** Data locale YYYY-MM-DD di un istante. */
export function localDateStr(ms: number, tz = TZ): string {
  const p = fmtParts(ms, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA');
  return `${p.year}-${p.month}-${p.day}`;
}

export function etichetta(ms: number, tz = TZ): string {
  const giorno = new Intl.DateTimeFormat('it-IT', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ms));
  const ora = new Intl.DateTimeFormat('it-IT', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  return `${giorno} alle ${ora}`;
}

export function isoLocale(ms: number, tz = TZ): string {
  const off = tzOffsetMin(ms, tz);
  const a = Math.abs(off);
  const hhmm = `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  const p = fmtParts(ms, tz, { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }, 'en-CA');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off >= 0 ? '+' : '-'}${hhmm}`;
}

const parseHM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };

/** Eventi Google Calendar -> intervalli occupati. Gli eventi "tutto il giorno" bloccano la giornata locale. */
export function eventiToOccupati(eventi: GoogleEvent[], tz = TZ): Intervallo[] {
  const norm = (v: GoogleEvent['start']) => (typeof v === 'string' ? (v.length === 10 ? { date: v } : { dateTime: v }) : v ?? {});
  const out: Intervallo[] = [];
  for (const e of eventi ?? []) {
    if (!e || e.status === 'cancelled' || e.transparency === 'transparent') continue;
    const s = norm(e.start); const f = norm(e.end);
    if (s.dateTime && f.dateTime) out.push({ start: Date.parse(s.dateTime), end: Date.parse(f.dateTime) });
    else if (s.date) {
      const [y, m, d] = s.date.split('-').map(Number);
      const [y2, m2, d2] = (f.date ?? s.date).split('-').map(Number);
      out.push({ start: localToUtcMs(y, m, d, 0, 0, tz), end: localToUtcMs(y2, m2, d2, 0, 0, tz) + (f.date ? 0 : 24 * 3600000) });
    }
  }
  return out;
}

export interface ParamSlot {
  now: number;
  durataMin: number;
  bufferMin?: number;
  orari: Orari;
  giorniChiusura?: string[];
  occupati?: Intervallo[];
  preferenze?: { giorni?: string[]; fascia?: Fascia | null };
  anticipoMin?: number;
  orizzonteGiorni?: number;
  passoMin?: number;
  tz?: string;
  n?: number;
}

interface Candidato { start: number; end: number; score: number }

/** Fino a `n` slot liberi, su giorni diversi, ordinati per preferenze del cliente. */
export function calcolaSlot(p: ParamSlot): Slot[] {
  const tz = p.tz ?? TZ;
  const n = p.n ?? 3;
  const passo = p.passoMin ?? 30;
  const durata = p.durataMin + (p.bufferMin ?? 0);
  const anticipo = (p.anticipoMin ?? 120) * 60000;
  const orizzonte = p.orizzonteGiorni ?? 21;
  const chiusi = new Set(p.giorniChiusura ?? []);
  const pref = p.preferenze ?? {};
  const prefGiorni = (pref.giorni ?? []).map((g) => g.toLowerCase());
  const occupati = p.occupati ?? [];

  const [y0, m0, d0] = localDateStr(p.now, tz).split('-').map(Number);
  const giorni: { slot: Candidato[] }[] = [];

  for (let i = 0; i <= orizzonte; i++) {
    const base = new Date(Date.UTC(y0, m0 - 1, d0 + i));
    const y = base.getUTCFullYear(); const m = base.getUTCMonth() + 1; const d = base.getUTCDate();
    if (chiusi.has(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)) continue;
    const nome = GIORNI[base.getUTCDay()];
    const candidati: Candidato[] = [];
    for (const [apre, chiude] of p.orari[nome] ?? []) {
      for (let t = parseHM(apre); t + durata <= parseHM(chiude); t += passo) {
        const start = localToUtcMs(y, m, d, Math.floor(t / 60), t % 60, tz);
        const end = start + durata * 60000;
        if (start < p.now + anticipo) continue;
        if (occupati.some((o) => start < o.end && end > o.start)) continue;
        let score = -i * 0.05;
        if (prefGiorni.includes(nome)) score += 2;
        if (pref.fascia === 'mattina' && t < 13 * 60) score += 2;
        if (pref.fascia === 'pomeriggio' && t >= 13 * 60) score += 2;
        candidati.push({ start, end: start + p.durataMin * 60000, score });
      }
    }
    if (candidati.length) giorni.push({ slot: candidati.sort((a, b) => b.score - a.score || a.start - b.start) });
  }

  const scelti = giorni.map((g) => g.slot[0]).sort((a, b) => b.score - a.score || a.start - b.start).slice(0, n);
  if (scelti.length < n) {
    const extra = giorni.flatMap((g) => g.slot.slice(1)).sort((a, b) => b.score - a.score || a.start - b.start);
    for (const c of extra) {
      if (scelti.length >= n) break;
      if (scelti.every((s) => Math.abs(s.start - c.start) >= 2 * 3600000)) scelti.push(c);
    }
  }
  return scelti.sort((a, b) => a.start - b.start).map((s, i) => ({
    n: i + 1, inizio: isoLocale(s.start, tz), fine: isoLocale(s.end, tz), etichetta: etichetta(s.start, tz),
  }));
}

export interface StoricoAppuntamento { inizio: Date | string; servizio: string; stato: string }
export type Abitudini =
  | { n: 0 }
  | { n: number; giornoAbituale: string | null; fasciaAbituale: Fascia; servizioAbituale: string; cadenzaSettimane: number | null; ultimoServizio: string; ultimaData: string };

const top = <T extends string>(arr: T[]): [T, number] => {
  const c = new Map<T, number>();
  for (const x of arr) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0];
};

/** Giorno/fascia/servizio abituali e cadenza media, dallo storico. */
export function analizzaAbitudini(appuntamenti: StoricoAppuntamento[], tz = TZ): Abitudini {
  const validi = (appuntamenti ?? [])
    .filter((a) => a && a.inizio && ['completato', 'confermato'].includes(a.stato))
    .map((a) => ({ ...a, ms: new Date(a.inizio).getTime() }))
    .filter((a) => !Number.isNaN(a.ms))
    .sort((a, b) => a.ms - b.ms);
  if (!validi.length) return { n: 0 };

  const giorni = validi.map((a) => new Intl.DateTimeFormat('it-IT', { timeZone: tz, weekday: 'long' }).format(new Date(a.ms)));
  const fasce = validi.map((a): Fascia => {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(a.ms)));
    return h < 13 ? 'mattina' : 'pomeriggio';
  });
  let cadenzaSettimane: number | null = null;
  if (validi.length >= 2) {
    const gap: number[] = [];
    for (let i = 1; i < validi.length; i++) gap.push((validi[i].ms - validi[i - 1].ms) / (7 * 86400000));
    cadenzaSettimane = Math.round((gap.reduce((a, b) => a + b, 0) / gap.length) * 10) / 10;
  }
  const [gTop, gN] = top(giorni);
  const ultimo = validi[validi.length - 1];
  return {
    n: validi.length,
    giornoAbituale: gN >= 2 || validi.length === 1 ? gTop : null,
    fasciaAbituale: top(fasce)[0],
    servizioAbituale: top(validi.map((a) => a.servizio))[0],
    cadenzaSettimane,
    ultimoServizio: ultimo.servizio,
    ultimaData: etichetta(ultimo.ms, tz),
  };
}

/** Trova un servizio per nome, anche approssimato ("vorrei un taglio" -> Taglio). */
export function trovaServizio<T extends { nome: string }>(richiesto: string, servizi: T[]): T | null {
  const q = (richiesto ?? '').toLowerCase().trim();
  if (!q) return null;
  const l = (s: T) => s.nome.toLowerCase();
  return servizi.find((s) => l(s) === q) ?? servizi.find((s) => l(s).includes(q)) ?? servizi.find((s) => q.includes(l(s))) ?? null;
}

/** "Sabato, martedì" -> ['sabato','martedi'] (senza accenti) */
export function normalizzaGiorni(s: string | null | undefined): string[] {
  return (s ?? '').split(/[,;]+/).map((x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()).filter(Boolean);
}
