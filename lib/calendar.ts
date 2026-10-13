import { google } from 'googleapis';
import type { CalendarPort } from './ports';
import { TZ } from './slots';

/** Google Calendar con service account: il calendario va condiviso con l'email del service account. */
export function createGoogleCalendar(serviceAccountJson: string): CalendarPort {
  const cred = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
  const auth = new google.auth.JWT({
    email: cred.client_email,
    key: cred.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const cal = google.calendar({ version: 'v3', auth });

  return {
    async listEvents(calendarId, da, a) {
      const eventi = [];
      let pageToken: string | undefined;
      do {
        const r = await cal.events.list({
          calendarId, timeMin: da.toISOString(), timeMax: a.toISOString(),
          singleEvents: true, orderBy: 'startTime', maxResults: 250, pageToken,
        });
        eventi.push(...(r.data.items ?? []));
        pageToken = r.data.nextPageToken ?? undefined;
      } while (pageToken);
      return eventi as import('./slots').GoogleEvent[];
    },

    async createEvent(calendarId, ev) {
      const r = await cal.events.insert({
        calendarId,
        requestBody: {
          summary: ev.summary,
          description: ev.description,
          start: { dateTime: ev.inizio.toISOString(), timeZone: TZ },
          end: { dateTime: ev.fine.toISOString(), timeZone: TZ },
        },
      });
      if (!r.data.id) throw new Error('Google Calendar: evento creato senza id');
      return { id: r.data.id };
    },
  };
}
