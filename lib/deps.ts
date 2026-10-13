import { eseguiAgente } from './agent';
import { createGoogleCalendar } from './calendar';
import { createDbRepo } from './db/repo';
import type { Deps } from './ports';
import { createWhatsApp } from './whatsapp';

const richiesta = (nome: string): string => {
  const v = process.env[nome];
  if (!v) throw new Error(`Variabile d'ambiente ${nome} mancante`);
  return v;
};

/** Dipendenze reali (database, WhatsApp, Google Calendar, Gemini) lette dalle variabili d'ambiente. */
export function creaDepsReali(): Deps {
  return {
    repo: createDbRepo(),
    whatsapp: createWhatsApp({ token: richiesta('WHATSAPP_TOKEN'), phoneNumberId: richiesta('WHATSAPP_PHONE_NUMBER_ID') }),
    calendar: createGoogleCalendar(richiesta('GOOGLE_SERVICE_ACCOUNT_JSON')),
    agent: eseguiAgente,
    now: () => new Date(),
  };
}
