import { timingSafeEqual } from 'node:crypto';
import { eseguiCronGiornaliero } from '@/lib/cron';
import { creaDepsReali } from '@/lib/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function autorizzato(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const atteso = Buffer.from(`Bearer ${secret}`);
  const ricevuto = Buffer.from(req.headers.get('authorization') ?? '');
  return ricevuto.length === atteso.length && timingSafeEqual(ricevuto, atteso);
}

/** Vercel Cron chiama questo endpoint con Authorization: Bearer $CRON_SECRET. */
export async function GET(req: Request) {
  if (!autorizzato(req)) return new Response('Non autorizzato', { status: 401 });
  const esito = await eseguiCronGiornaliero(creaDepsReali());
  return Response.json(esito);
}
