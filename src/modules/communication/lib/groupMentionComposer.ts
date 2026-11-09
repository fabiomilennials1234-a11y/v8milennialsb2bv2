/**
 * Menção (@) no ENVIO para grupo — a metade do composer.
 *
 * A leitura (bolha recebida com `@<LID>` → `@Nome`) mora em `groupMentions.ts`;
 * este módulo é o caminho de volta:
 *
 *  - `detectMentionTrigger` — o vendedor digitou `@termo` no cursor? Mesma regra
 *    de borda da leitura (`WORD_CHAR`): `a@b` (e-mail) não abre o seletor.
 *  - `buildMentionOptions` — "Todos" + participantes filtrados por nome/número.
 *    Participante sem telefone (só LID) não entra: a Uazapi documenta menção
 *    por número; LID não foi verificado.
 *  - `applyMention` — troca o `@termo` pelo token escolhido.
 *  - `deriveMentions` — no ENVIO, a lista sai do TEXTO FINAL, não de estado do
 *    seletor: só `@<número>` que ainda está no texto e é de participante
 *    conhecido. Apagou a menção na mão? Ela some da lista. `@todos`/`@all` no
 *    texto a Uazapi resolve sozinha — não precisa entrar aqui.
 */

import { MAX_MENTIONS, WORD_CHAR } from "./groupMentions";

export { MAX_MENTIONS };

export interface GroupParticipant {
  /** Só dígitos; `null` quando o participante só tem LID. */
  phone: string | null;
  lid: string | null;
  name: string | null;
  isAdmin: boolean;
}

export interface MentionTrigger {
  /** Índice do `@`. */
  start: number;
  /** Fim do termo (posição do cursor). */
  end: number;
  /** O que foi digitado depois do `@`. */
  query: string;
}

export type MentionOption =
  | { kind: "all"; token: "todos" }
  | { kind: "participant"; token: string; participant: GroupParticipant & { phone: string } };

/** Token inserido para "Todos" — a Uazapi normaliza `@todos` para `@all`. */
export const MENTION_ALL_TOKEN = "todos";
/** Itens no seletor. Grupo de 1000 pessoas se acha digitando, não rolando. */
export const MAX_MENTION_OPTIONS = 8;

/** Termo depois do `@`: sem espaço, até 40 caracteres. */
const QUERY = /^[\p{L}\p{N}_.\-+]{0,40}$/u;

export function detectMentionTrigger(text: string, caret: number): MentionTrigger | null {
  if (caret < 1 || caret > text.length) return null;
  const at = text.lastIndexOf("@", caret - 1);
  if (at < 0) return null;
  const before = at > 0 ? text[at - 1] : "";
  if (before && (WORD_CHAR.test(before) || before === "@")) return null;
  const query = text.slice(at + 1, caret);
  if (!QUERY.test(query)) return null;
  return { start: at, end: caret, query };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

export function buildMentionOptions(
  participants: readonly GroupParticipant[] | undefined,
  query: string,
): MentionOption[] {
  const q = fold(query.trim());
  const qDigits = q.replace(/\D/g, "");
  const options: MentionOption[] = [];
  if (!q || fold(MENTION_ALL_TOKEN).startsWith(q) || "all".startsWith(q)) {
    options.push({ kind: "all", token: MENTION_ALL_TOKEN });
  }
  const matches = (participants ?? [])
    .filter((p): p is GroupParticipant & { phone: string } => !!p.phone)
    .filter((p) => {
      if (!q) return true;
      if (p.name && fold(p.name).includes(q)) return true;
      return qDigits.length > 0 && qDigits === q && p.phone.includes(qDigits);
    })
    .sort((a, b) => {
      if (!!a.name !== !!b.name) return a.name ? -1 : 1;
      return collator.compare(a.name ?? "", b.name ?? "") || a.phone.localeCompare(b.phone);
    });
  for (const participant of matches) {
    if (options.length >= MAX_MENTION_OPTIONS) break;
    options.push({ kind: "participant", token: participant.phone, participant });
  }
  return options;
}

/** Substitui `@termo` por `@<token> ` e devolve o texto e o cursor novos. */
export function applyMention(text: string, trigger: MentionTrigger, token: string): { text: string; caret: number } {
  const after = text.slice(trigger.end);
  const insert = `@${token}${after.startsWith(" ") ? "" : " "}`;
  const next = text.slice(0, trigger.start) + insert + after;
  const caret = trigger.start + insert.length + (after.startsWith(" ") ? 1 : 0);
  return { text: next, caret };
}

/**
 * Números a mencionar, tirados do texto que vai ser enviado. Só o `@<dígitos>`
 * com borda válida, inteiro (não prefixo de número maior) e que pertence a um
 * participante conhecido. Sem participante conhecido, lista vazia — um `@123`
 * qualquer digitado continua texto.
 */
export function deriveMentions(text: string | null | undefined, knownPhones: Iterable<string>): string[] {
  if (!text || !text.includes("@")) return [];
  const known = new Set(knownPhones);
  if (known.size === 0) return [];
  const out: string[] = [];
  const token = /@(\d{8,20})(?!\d)/g;
  for (let m = token.exec(text); m; m = token.exec(text)) {
    const before = m.index > 0 ? text[m.index - 1] : "";
    if (before && WORD_CHAR.test(before)) continue;
    if (!known.has(m[1]) || out.includes(m[1])) continue;
    out.push(m[1]);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/** Valida a resposta do proxy: só o que tem forma de participante passa. */
export function parseGroupParticipants(raw: unknown): GroupParticipant[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupParticipant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const phone = typeof p.phone === "string" && /^\d{8,20}$/.test(p.phone) ? p.phone : null;
    const lid = typeof p.lid === "string" && p.lid ? p.lid : null;
    if (!phone && !lid) continue;
    out.push({
      phone,
      lid,
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : null,
      isAdmin: p.isAdmin === true,
    });
  }
  return out;
}
