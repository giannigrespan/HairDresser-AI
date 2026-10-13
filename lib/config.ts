import type { Repo } from './repo';
import type { Config } from './types';

const json = <T>(s: string | undefined, def: T, nome: string): T => {
  if (!s) return def;
  try { return JSON.parse(s) as T; } catch { throw new Error(`Impostazione '${nome}' non è un JSON valido`); }
};

/** Legge la tabella `impostazioni` (chiave/valore) e la valida. */
export async function loadConfig(repo: Repo): Promise<Config> {
  const kv = await repo.impostazioni();
  if (!kv.id_calendario) throw new Error("Impostazione 'id_calendario' mancante");
  return {
    nomeSalone: kv.nome_salone || 'il nostro salone',
    idCalendario: kv.id_calendario,
    orari: json(kv.orari, {}, 'orari'),
    giorniChiusura: json(kv.giorni_chiusura, [], 'giorni_chiusura'),
    anticipoMin: Number(kv.anticipo_min ?? 120),
    orizzonteGiorni: Number(kv.orizzonte_giorni ?? 21),
    passoMin: Number(kv.passo_min ?? 30),
    telefonoTitolare: kv.telefono_titolare || null,
  };
}
