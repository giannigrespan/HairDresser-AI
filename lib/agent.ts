import { google } from '@ai-sdk/google';
import { generateText, isStepCount } from 'ai';
import type { AgentInput } from './ports';

export const MODELLO = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/** Esegue Gemini con gli strumenti; ripete fino a 8 passi (strumento -> risultato -> risposta). */
export async function eseguiAgente({ system, text, tools }: AgentInput): Promise<string> {
  const r = await generateText({
    model: google(MODELLO),
    system,
    prompt: text,
    tools,
    temperature: 0.3,
    stopWhen: isStepCount(8),
  });
  return r.text;
}
