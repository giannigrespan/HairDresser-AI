import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { eseguiCronGiornaliero } from '../lib/cron';
import { estraiMessaggi, verificaFirma } from '../lib/whatsapp';
import { ADESSO, creaDeps } from './helpers/memory';

const firma = (corpo: string, secret: string) => `sha256=${createHmac('sha256', secret).update(corpo).digest('hex')}`;

describe('webhook WhatsApp', () => {
  test('firma valida / alterata / assente', () => {
    const corpo = '{"a":1}';
    expect(verificaFirma(corpo, firma(corpo, 's3'), 's3')).toBe(true);
    expect(verificaFirma(corpo + ' ', firma(corpo, 's3'), 's3')).toBe(false);
    expect(verificaFirma(corpo, firma(corpo, 'altro'), 's3')).toBe(false);
    expect(verificaFirma(corpo, null, 's3')).toBe(false);
    expect(verificaFirma(corpo, 'sha256=zz', 's3')).toBe(false);
  });

  test('estrae testo e non testo, ignora gli aggiornamenti di stato', () => {
    const payload = { entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '393401234567', profile: { name: 'Giulia' } }],
      messages: [
        { id: 'm1', from: '393401234567', type: 'text', text: { body: 'Ciao' } },
        { id: 'm2', from: '393401234567', type: 'audio' },
      ],
    } }, { value: { statuses: [{ id: 'x', status: 'read' }] } }] }] };
    expect(estraiMessaggi(payload)).toEqual([
      { id: 'm1', telefono: '+393401234567', nome: 'Giulia', tipo: 'text', testo: 'Ciao' },
      { id: 'm2', telefono: '+393401234567', nome: 'Giulia', tipo: 'audio', testo: null },
    ]);
    expect(estraiMessaggi({})).toEqual([]);
    expect(estraiMessaggi(null)).toEqual([]);
  });
});

describe('route /api/whatsapp', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('GET: handshake corretto e token errato', async () => {
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'tok');
    const { GET } = await import('../app/api/whatsapp/route');
    const ok = await GET(new Request('http://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=123'));
    expect([ok.status, await ok.text()]).toEqual([200, '123']);
    expect((await GET(new Request('http://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=1'))).status).toBe(403);
  });

  test('GET: senza token configurato rifiuta sempre', async () => {
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', '');
    const { GET } = await import('../app/api/whatsapp/route');
    expect((await GET(new Request('http://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=1'))).status).toBe(403);
  });

  test('POST: firma errata -> 401, senza segreto configurato -> 401', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', 'segreto');
    const { POST } = await import('../app/api/whatsapp/route');
    const r = await POST(new Request('http://x', { method: 'POST', body: '{}', headers: { 'x-hub-signature-256': 'sha256=00' } }));
    expect(r.status).toBe(401);
    vi.stubEnv('WHATSAPP_APP_SECRET', '');
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}', headers: { 'x-hub-signature-256': firma('{}', '') } }))).status).toBe(401);
  });

  test('POST: firma valida senza messaggi -> 200 e nessuna elaborazione', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', 'segreto');
    const { POST } = await import('../app/api/whatsapp/route');
    const corpo = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [] } }] }] });
    const r = await POST(new Request('http://x', { method: 'POST', body: corpo, headers: { 'x-hub-signature-256': firma(corpo, 'segreto') } }));
    expect(r.status).toBe(200);
  });
});

describe('route /api/cron/daily', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('richiede Authorization: Bearer CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', 'abc');
    const { GET } = await import('../app/api/cron/daily/route');
    expect((await GET(new Request('http://x'))).status).toBe(401);
    expect((await GET(new Request('http://x', { headers: { authorization: 'Bearer sbagliato' } }))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(new Request('http://x', { headers: { authorization: 'Bearer ' } }))).status).toBe(401);
  });
});

describe('cron giornaliero', () => {
  const ora = (h: number) => new Date(ADESSO.getTime() + h * 3600000);

  test('promemoria solo per domani e una sola volta; chiude i passati; aggiorna le visite', async () => {
    const { deps, repo, whatsapp } = creaDeps();
    await repo.getOrCreateCliente('+393401234567', 'Giulia');
    const domani = repo.aggiungiAppuntamento({ telefono: '+393401234567', nomeCliente: 'Giulia', servizio: 'Taglio', inizio: ora(24), stato: 'confermato' });
    repo.aggiungiAppuntamento({ telefono: '+393401234567', servizio: 'Taglio', inizio: ora(24), stato: 'confermato', promemoriaInviato: true });
    repo.aggiungiAppuntamento({ telefono: '+393401234567', servizio: 'Colore', inizio: ora(72), stato: 'confermato' });
    const ieri = repo.aggiungiAppuntamento({ telefono: '+393401234567', servizio: 'Colore', inizio: ora(-30), stato: 'confermato' });

    const e1 = await eseguiCronGiornaliero(deps);
    expect(e1).toMatchObject({ promemoria: 1, completati: 1, errori: 0 });
    expect(whatsapp.template).toEqual([{ to: '+393401234567', name: 'promemoria_appuntamento', params: ['Giulia', expect.stringContaining('ottobre'), 'Taglio'] }]);
    expect(domani.promemoriaInviato).toBe(true);
    expect(ieri.stato).toBe('completato');
    expect(repo.clienti.get('+393401234567')).toMatchObject({ nVisite: 1 });

    const e2 = await eseguiCronGiornaliero(deps);
    expect(e2).toMatchObject({ promemoria: 0, completati: 0 });
  });

  test('un invio fallito non blocca gli altri e non segna il promemoria', async () => {
    const { deps, repo, whatsapp } = creaDeps();
    const a = repo.aggiungiAppuntamento({ telefono: '+391', servizio: 'Taglio', inizio: ora(24), stato: 'confermato' });
    const b = repo.aggiungiAppuntamento({ telefono: '+392', servizio: 'Taglio', inizio: ora(25), stato: 'confermato' });
    whatsapp.sendTemplate = async (to) => { if (to === '+391') throw new Error('template non approvato'); };
    const e = await eseguiCronGiornaliero(deps);
    expect(e).toMatchObject({ promemoria: 1, errori: 1 });
    expect([a.promemoriaInviato, b.promemoriaInviato]).toEqual([false, true]);
  });

  test('elimina i messaggi più vecchi di 30 giorni', async () => {
    const { deps, repo } = creaDeps();
    await repo.aggiungiMessaggi([
      { telefono: '+1', ruolo: 'cliente', testo: 'vecchio', ts: new Date(ADESSO.getTime() - 40 * 86400000) },
      { telefono: '+1', ruolo: 'cliente', testo: 'recente', ts: new Date(ADESSO.getTime() - 5 * 86400000) },
    ]);
    expect((await eseguiCronGiornaliero(deps)).messaggiEliminati).toBe(1);
    expect(repo.msgs.map((m) => m.testo)).toEqual(['recente']);
  });
});
