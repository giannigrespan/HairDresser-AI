import type { AgentInput, CalendarPort, Deps, WhatsAppPort } from '../../lib/ports';
import type { Repo } from '../../lib/repo';
import type { GoogleEvent } from '../../lib/slots';
import type { Appuntamento, Cliente, Messaggio, Servizio } from '../../lib/types';

export const ORARI = JSON.stringify({
  lunedi: [], martedi: [['09:00', '19:00']], mercoledi: [['09:00', '19:00']], giovedi: [['09:00', '19:00']],
  venerdi: [['09:00', '19:00']], sabato: [['09:00', '17:00']], domenica: [],
});

export class MemoryRepo implements Repo {
  visti = new Set<string>();
  clienti = new Map<string, Cliente>();
  appunt: Appuntamento[] = [];
  msgs: Messaggio[] = [];
  kv: Record<string, string> = {
    nome_salone: 'Salone Bella', id_calendario: 'cal@x', orari: ORARI, giorni_chiusura: '[]', telefono_titolare: '+393331112222',
  };
  listino: Servizio[] = [
    { nome: 'Taglio', durataMin: 45, bufferMin: 15, prezzo: 25, note: null },
    { nome: 'Colore', durataMin: 120, bufferMin: 0, prezzo: 60, note: 'ricrescita' },
  ];
  private nextId = 1;
  private code = new Map<string, Promise<unknown>>();

  async claimMessage(id: string) { if (this.visti.has(id)) return false; this.visti.add(id); return true; }
  async withLock<T>(k: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.code.get(k) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.code.set(k, run.catch(() => undefined));
    return run;
  }
  async getOrCreateCliente(telefono: string, nome: string) {
    if (!this.clienti.has(telefono)) {
      this.clienti.set(telefono, { telefono, nome: nome || null, giorniPreferiti: null, fasciaPreferita: null, stilistaPreferito: null, note: null, ultimaVisita: null, nVisite: 0, nNoShow: 0, consensoDati: false });
    }
    return this.clienti.get(telefono)!;
  }
  async aggiornaCliente(t: string, patch: Partial<Cliente>) { Object.assign(this.clienti.get(t)!, patch); }
  async appuntamentiCliente(t: string) { return this.appunt.filter((a) => a.telefono === t).sort((a, b) => a.inizio.getTime() - b.inizio.getTime()); }
  async ultimiMessaggi(t: string, n: number) { return this.msgs.filter((m) => m.telefono === t).slice(-n); }
  async aggiungiMessaggi(r: Messaggio[]) { this.msgs.push(...r); }
  async impostazioni() { return this.kv; }
  async servizi() { return this.listino; }
  async sostituisciProposte(telefono: string, nomeCliente: string | null, proposte: { servizio: string; inizio: Date; fine: Date; opzione: number }[]) {
    this.appunt = this.appunt.filter((a) => !(a.telefono === telefono && a.stato === 'proposto'));
    for (const p of proposte) this.appunt.push({ id: this.nextId++, telefono, nomeCliente, stato: 'proposto', eventId: null, promemoriaInviato: false, ...p });
  }
  async confermaProposta(id: number, eventId: string, nomeCliente: string | null) {
    const a = this.appunt.find((x) => x.id === id)!;
    Object.assign(a, { stato: 'confermato', eventId, nomeCliente, opzione: null });
  }
  async eliminaProposte(t: string) { this.appunt = this.appunt.filter((a) => !(a.telefono === t && a.stato === 'proposto')); }
  async appuntamentiConfermati() { return this.appunt.filter((a) => a.stato === 'confermato'); }
  async segnaPromemoria(id: number) { this.appunt.find((a) => a.id === id)!.promemoriaInviato = true; }
  async completaAppuntamento(id: number) {
    const a = this.appunt.find((x) => x.id === id)!;
    a.stato = 'completato';
    const c = this.clienti.get(a.telefono);
    if (c) { c.nVisite++; c.ultimaVisita = a.fine; }
  }
  async eliminaMessaggiPrima(data: Date) { const n = this.msgs.length; this.msgs = this.msgs.filter((m) => m.ts >= data); return n - this.msgs.length; }
  async cancellaDatiCliente(t: string) {
    this.msgs = this.msgs.filter((m) => m.telefono !== t);
    this.appunt = this.appunt.filter((a) => a.telefono !== t);
    this.clienti.delete(t);
  }

  aggiungiAppuntamento(a: Partial<Appuntamento> & Pick<Appuntamento, 'telefono' | 'servizio' | 'inizio' | 'stato'>) {
    const row: Appuntamento = { id: this.nextId++, nomeCliente: null, fine: new Date(a.inizio.getTime() + 3600000), opzione: null, eventId: null, promemoriaInviato: false, ...a };
    this.appunt.push(row);
    return row;
  }
}

export class FakeCalendar implements CalendarPort {
  eventi: GoogleEvent[] = [];
  creati: { calendarId: string; summary: string; inizio: Date; fine: Date }[] = [];
  async listEvents() { return this.eventi; }
  async createEvent(calendarId: string, ev: { summary: string; description: string; inizio: Date; fine: Date }) {
    this.creati.push({ calendarId, summary: ev.summary, inizio: ev.inizio, fine: ev.fine });
    this.eventi.push({ start: { dateTime: ev.inizio.toISOString() }, end: { dateTime: ev.fine.toISOString() } });
    return { id: `evt${this.creati.length}` };
  }
}

export class FakeWhatsApp implements WhatsAppPort {
  testi: { to: string; body: string }[] = [];
  template: { to: string; name: string; params: string[] }[] = [];
  async sendText(to: string, body: string) { this.testi.push({ to, body }); }
  async sendTemplate(to: string, name: string, params: string[]) { this.template.push({ to, name, params }); }
}

/** 12 ottobre 2026, 10:00 a Roma (lunedì). */
export const ADESSO = new Date('2026-10-12T08:00:00Z');

export function creaDeps(over: Partial<Deps> = {}) {
  const repo = new MemoryRepo();
  const whatsapp = new FakeWhatsApp();
  const calendar = new FakeCalendar();
  const deps: Deps = {
    repo, whatsapp, calendar, now: () => ADESSO,
    agent: async (_: AgentInput) => 'Buongiorno! Come posso aiutarla?',
    ...over,
  };
  return { deps, repo, whatsapp, calendar };
}
