import { readFileSync } from 'node:fs';
import path from 'node:path';

let template: string | undefined;

/** Il prompt vive in prompts/system_prompt.md (modificabile senza toccare il codice). */
export function leggiTemplate(): string {
  template ??= readFileSync(path.join(process.cwd(), 'prompts', 'system_prompt.md'), 'utf8').trim();
  return template;
}

export function renderPrompt(vars: Record<string, string>, tpl = leggiTemplate()): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}
