import type { GoogleEvent } from './slots';

export interface WhatsAppPort {
  sendText(to: string, body: string): Promise<void>;
  /** Messaggio template (obbligatorio fuori dalla finestra di 24 ore). Lingua: it. */
  sendTemplate(to: string, template: string, params: string[]): Promise<void>;
}

export interface CalendarPort {
  listEvents(calendarId: string, da: Date, a: Date): Promise<GoogleEvent[]>;
  createEvent(calendarId: string, ev: { summary: string; description: string; inizio: Date; fine: Date }): Promise<{ id: string }>;
}

export interface AgentInput {
  system: string;
  text: string;
  tools: import('ai').ToolSet;
}

export interface Deps {
  repo: import('./repo').Repo;
  whatsapp: WhatsAppPort;
  calendar: CalendarPort;
  /** Esegue il modello e restituisce il testo della risposta (iniettabile nei test). */
  agent: (input: AgentInput) => Promise<string>;
  now: () => Date;
}
