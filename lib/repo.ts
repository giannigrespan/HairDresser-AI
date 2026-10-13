import type { Appuntamento, Cliente, ClientePatch, Messaggio, NuovaProposta, Servizio } from './types';

/** Accesso ai dati. Implementazioni: Postgres/Neon (lib/db/repo.ts) e in memoria (tests). */
export interface Repo {
  /** true se il messaggio non era mai stato visto (e lo marca come visto). */
  claimMessage(messageId: string): Promise<boolean>;
  /** Serializza le elaborazioni dello stesso cliente. */
  withLock<T>(chiave: string, fn: () => Promise<T>): Promise<T>;

  getOrCreateCliente(telefono: string, nomeProfilo: string): Promise<Cliente>;
  aggiornaCliente(telefono: string, patch: ClientePatch): Promise<void>;
  appuntamentiCliente(telefono: string): Promise<Appuntamento[]>;
  ultimiMessaggi(telefono: string, n: number): Promise<Messaggio[]>;
  aggiungiMessaggi(righe: Messaggio[]): Promise<void>;

  impostazioni(): Promise<Record<string, string>>;
  servizi(): Promise<Servizio[]>;

  /** Sostituisce le proposte pendenti del cliente con quelle nuove. */
  sostituisciProposte(telefono: string, nomeCliente: string | null, proposte: NuovaProposta[]): Promise<void>;
  confermaProposta(id: number, eventId: string, nomeCliente: string | null): Promise<void>;
  eliminaProposte(telefono: string): Promise<void>;

  appuntamentiConfermati(): Promise<Appuntamento[]>;
  segnaPromemoria(id: number): Promise<void>;
  /** Segna completato e aggiorna n_visite/ultima_visita del cliente. */
  completaAppuntamento(id: number): Promise<void>;
  eliminaMessaggiPrima(data: Date): Promise<number>;
  cancellaDatiCliente(telefono: string): Promise<void>;
}
