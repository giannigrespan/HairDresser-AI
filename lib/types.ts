export interface Cliente {
  telefono: string;
  nome: string | null;
  giorniPreferiti: string | null;
  fasciaPreferita: string | null;
  stilistaPreferito: string | null;
  note: string | null;
  ultimaVisita: Date | null;
  nVisite: number;
  nNoShow: number;
  consensoDati: boolean;
}

export type StatoAppuntamento = 'proposto' | 'confermato' | 'completato' | 'annullato' | 'no_show';

export interface Appuntamento {
  id: number;
  telefono: string;
  nomeCliente: string | null;
  servizio: string;
  inizio: Date;
  fine: Date;
  stato: StatoAppuntamento;
  opzione: number | null;
  eventId: string | null;
  promemoriaInviato: boolean;
}

export interface NuovaProposta {
  servizio: string;
  inizio: Date;
  fine: Date;
  opzione: number;
}

export interface Messaggio {
  telefono: string;
  ruolo: 'cliente' | 'assistente';
  testo: string;
  ts: Date;
}

export interface Servizio {
  nome: string;
  durataMin: number;
  bufferMin: number;
  prezzo: number | null;
  note: string | null;
}

/** Campi del cliente modificabili dall'agente (whitelist). */
export const CHIAVI_PREFERENZA = ['nome', 'giorniPreferiti', 'fasciaPreferita', 'stilistaPreferito', 'note', 'consensoDati'] as const;
export type ChiavePreferenza = (typeof CHIAVI_PREFERENZA)[number];
export type ClientePatch = Partial<{ nome: string; giorniPreferiti: string; fasciaPreferita: string; stilistaPreferito: string; note: string; consensoDati: boolean }>;

export interface Config {
  nomeSalone: string;
  idCalendario: string;
  orari: import('./slots').Orari;
  giorniChiusura: string[];
  anticipoMin: number;
  orizzonteGiorni: number;
  passoMin: number;
  telefonoTitolare: string | null;
}
