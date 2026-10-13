import { after } from 'next/server';
import { creaDepsReali } from '@/lib/deps';
import { gestisciMessaggio } from '@/lib/handler';
import { estraiMessaggi, verificaFirma } from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Handshake di verifica del webhook (Meta chiama con hub.mode/hub.verify_token/hub.challenge). */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === token) {
    return new Response(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  const corpo = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !verificaFirma(corpo, req.headers.get('x-hub-signature-256'), secret)) {
    return new Response('Firma non valida', { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(corpo); } catch { return new Response('JSON non valido', { status: 400 }); }

  const messaggi = estraiMessaggi(payload);
  if (messaggi.length) {
    // Risponde subito 200 a Meta (altrimenti ritenta) ed elabora dopo l'invio della risposta.
    after(async () => {
      const deps = creaDepsReali();
      for (const m of messaggi) await gestisciMessaggio(deps, m);
    });
  }
  return new Response('ok', { status: 200 });
}

