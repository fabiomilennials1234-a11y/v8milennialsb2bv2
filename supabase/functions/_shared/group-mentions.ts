/**
 * Menção (@) no ENVIO para grupo do WhatsApp — Uazapi.
 *
 * Dois contratos puros usados pelo `whatsapp-api-proxy`:
 *
 *  1. `sanitizeMentions` — o campo `mentions` que o composer manda junto do
 *     texto/legenda. A Uazapi recebe `mentions` como STRING ("números separados
 *     por vírgula, só em grupos", ou `all`). Aqui a lista vinda do navegador é
 *     filtrada antes de chegar no provedor: só vale para destino de grupo
 *     válido, cada item é número puro (8–20 dígitos) ou exatamente `all`,
 *     sem repetição e com teto. Fora disso a lista é DESCARTADA em silêncio —
 *     uma menção inválida nunca pode derrubar o envio da mensagem.
 *
 *  2. `normalizeGroupParticipants` — a resposta de `POST /group/info`, reduzida
 *     ao mínimo que o seletor de menção precisa (PII mínima): telefone em
 *     dígitos, LID, nome exibido e se é admin. Nada de JID cru, foto, convite.
 *
 * `@todos`/`@all` no TEXTO a Uazapi já trata como menção a todos; não depende
 * deste campo.
 */

import { isValidGroupJid } from "./whatsapp-jid.ts";

/** Teto de menções por mensagem. Ninguém marca 50 pessoas à mão. */
export const MAX_MENTIONS = 50;
/** Teto de participantes devolvidos (o WhatsApp limita grupos a 1024). */
export const MAX_GROUP_PARTICIPANTS = 1024;
/** Nome exibido maior que isto é truncado — vai para um item de lista. */
const MAX_NAME_LENGTH = 80;

const MENTION_NUMBER = /^\d{8,20}$/;
const PHONE_JID = /^(\d{8,20})(?::\d+)?@s\.whatsapp\.net$/;
const LID_JID = /^\d{5,20}@lid$/;

/**
 * Lista de menções pronta para o provider, ou `undefined` quando não há nada
 * a mencionar (destino não é grupo, payload ausente/malformado, todos os itens
 * inválidos). `undefined` = payload do provedor idêntico ao de antes.
 *
 * `all` engole os números: mencionar todos já inclui cada um.
 */
export function sanitizeMentions(number: unknown, raw: unknown): string[] | undefined {
  if (!isValidGroupJid(number) || !Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (value === "all") return ["all"];
    if (!MENTION_NUMBER.test(value) || out.includes(value)) continue;
    if (out.length >= MAX_MENTIONS) continue;
    out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

export interface GroupParticipant {
  /** Só dígitos. `null` quando o WhatsApp não expõe o número (participante só-LID). */
  phone: string | null;
  /** `<dígitos>@lid`, quando conhecido. */
  lid: string | null;
  name: string | null;
  isAdmin: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function phoneOf(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  if (MENTION_NUMBER.test(s)) return s;
  return PHONE_JID.exec(s)?.[1] ?? null;
}

/**
 * `POST /group/info` → participantes enxutos. Tolerante ao formato: o grupo
 * pode vir na raiz ou embrulhado em `group`/`data`, e `Participants` pode ser
 * `null` (a spec documenta). Linha sem telefone nem LID é descartada; repetida
 * (mesmo telefone ou mesmo LID) também.
 */
export function normalizeGroupParticipants(raw: unknown): GroupParticipant[] {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const group = [root, root.group, root.data].find(
    (g) => g && typeof g === "object" && Array.isArray((g as Record<string, unknown>).Participants),
  ) as Record<string, unknown> | undefined;
  const list = (group?.Participants ?? []) as unknown[];

  const out: GroupParticipant[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (out.length >= MAX_GROUP_PARTICIPANTS) break;
    if (!entry || typeof entry !== "object") continue;
    const p = entry as Record<string, unknown>;
    const jid = str(p.JID);
    const phone = phoneOf(p.PhoneNumber) ?? phoneOf(jid);
    const lidRaw = str(p.LID) ?? jid;
    const lid = lidRaw && LID_JID.test(lidRaw) ? lidRaw : null;
    if (!phone && !lid) continue;
    const keys = [phone && `p:${phone}`, lid && `l:${lid}`].filter(Boolean) as string[];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    const name = str(p.DisplayName);
    out.push({
      phone,
      lid,
      name: name ? name.slice(0, MAX_NAME_LENGTH) : null,
      isAdmin: p.IsAdmin === true || p.IsSuperAdmin === true,
    });
  }
  return out;
}
