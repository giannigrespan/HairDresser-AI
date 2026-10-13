import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WhatsAppPort } from './ports';

const GRAPH = 'https://graph.facebook.com/v23.0';

/** Verifica l'header X-Hub-Signature-256 sul corpo grezzo della richiesta. */
export function verificaFirma(corpo: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const atteso = createHmac('sha256', appSecret).update(corpo).digest();
  const ricevuto = Buffer.from(header.slice(7), 'hex');
  return ricevuto.length === atteso.length && timingSafeEqual(ricevuto, atteso);
}

export interface MessaggioInArrivo {
  id: string;
  /** Telefono in formato E.164, es. +393401234567 */
  telefono: string;
  nome: string;
  tipo: string;
  testo: string | null;
}

/** Estrae i messaggi dal payload del webhook (ignora gli aggiornamenti di stato). */
export function estraiMessaggi(payload: unknown): MessaggioInArrivo[] {
  const out: MessaggioInArrivo[] = [];
  const p = payload as { entry?: { changes?: { value?: any }[] }[] };
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      for (const m of v?.messages ?? []) {
        if (!m?.id || !m?.from) continue;
        const contatto = (v.contacts ?? []).find((c: any) => c.wa_id === m.from) ?? v.contacts?.[0];
        out.push({
          id: String(m.id),
          telefono: `+${String(m.from).replace(/^\+/, '')}`,
          nome: contatto?.profile?.name ?? '',
          tipo: String(m.type ?? ''),
          testo: m.type === 'text' ? String(m.text?.body ?? '') : null,
        });
      }
    }
  }
  return out;
}

export function createWhatsApp(env: { token: string; phoneNumberId: string }): WhatsAppPort {
  async function post(body: Record<string, unknown>) {
    const res = await fetch(`${GRAPH}/${env.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const numero = (to: string) => to.replace(/^\+/, '');
  return {
    sendText: (to, body) => post({ to: numero(to), type: 'text', text: { body, preview_url: false } }),
    sendTemplate: (to, name, params) =>
      post({
        to: numero(to),
        type: 'template',
        template: {
          name,
          language: { code: 'it' },
          components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
        },
      }),
  };
}
