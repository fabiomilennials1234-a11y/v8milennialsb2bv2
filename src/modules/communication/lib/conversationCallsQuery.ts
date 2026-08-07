/**
 * Query canônica das ligações de UMA conversa do chat.
 *
 * ── Por que `call_logs` e não `voip_calls` ──
 * `voip_calls` é o estado cru do plano de voz (`status`, `end_reason`,
 * `connected_at`). Derivar "atendeu / não atendeu / quanto durou" a partir dele
 * no navegador seria uma SEGUNDA implementação da regra que
 * `fn_voip_project_call_log` já aplica no banco — duas cópias que divergem no
 * primeiro `end_reason` novo que o VPS inventar.
 *
 * `call_logs` é a camada já projetada: traz `outcome` e `duration_seconds`
 * prontos. E, decisivo, é a única das duas que enxerga a ligação REGISTRADA À
 * MÃO (`LogCallModal`) — `voip_calls` só conhece chamada que passou pelo
 * TorqueCalls. Quem abre a conversa pergunta "o que aconteceu com esse lead",
 * e a ligação anotada pelo vendedor faz parte da resposta.
 *
 * Bônus: `call_logs` existe em `src/integrations/supabase/types.ts`;
 * `voip_calls` NÃO (nenhuma das duas tabelas de voz foi regerada), então lê-la
 * exigiria `(supabase.from as any)`.
 *
 * ── Como a ligação encontra a conversa ──
 * A conversa do chat é identificada por TELEFONE NORMALIZADO, não por lead:
 * medido em produção (2026-08-02), 1.790.210 de 2.117.873 linhas de
 * `whatsapp_messages` (84,5%) têm `lead_id` NULO, enquanto `normalized_phone`
 * está 100% populado. Casar só por `lead_id` perderia a maioria das conversas.
 *
 * O telefone é a chave porque `fn_voip_project_call_log` grava
 * `call_logs.phone_number := voip_calls.peer_phone`, e o caso comum é canônico:
 * medido em prod, `peer_phone = '48996458738'` e
 * `whatsapp_messages.normalized_phone = '48996458738'`. Mas o produtor NÃO
 * garante esse formato — ver `phoneVariants()` abaixo, que é a resposta a isso.
 * (`leads.phone` não serve de chave: a mesma base guarda `'+55 48 9189-2653'`,
 * `'+554899053409'` e `'554891470458'`.)
 *
 * Mesmo assim o `lead_id` entra como SEGUNDA identidade, em OU: a ligação
 * registrada à mão nasce com lead e pode ter `phone_number` nulo — é
 * exatamente o caso da única linha de `call_logs` que existe hoje em prod.
 *
 * ── Janela ──
 * Espelha a janela das mensagens (`whatsappMessagesQuery.ts`): DESC +
 * `.limit()` + reverse, ancorada no fim da conversa. Dar às ligações um recorte
 * de direção DIFERENTE do das mensagens abriria buraco (ligação sem a mensagem
 * vizinha) ou ligação órfã antes da primeira mensagem carregada.
 *
 * A versão anterior deste comentário dizia "sem `.limit()`, de propósito,
 * porque a thread inteira vem num fetch só". Isso era falso em prod: o
 * PostgREST corta em `max_rows = 1000` sem devolver erro, e com ordem
 * ASCENDENTE o que sobrava eram as linhas mais ANTIGAS. Limite implícito não é
 * "sem limite" — é limite que ninguém vê.
 *
 * As duas janelas ainda não são o MESMO recorte (tabelas e volumes distintos);
 * hoje isso não morde porque `call_logs` é minúsculo. Quando a thread virar
 * paginada, o certo é recortar as ligações pelo intervalo da página de
 * mensagens — e aí este comentário é o aviso.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";
import { THREAD_MESSAGE_LIMIT } from "./whatsappMessagesQuery";

/**
 * Colunas que a peça da conversa desenha.
 *
 * `notes` continua deliberadamente FORA: a anotação comercial do vendedor não
 * vai para o corpo da thread.
 *
 * As três de gravação entraram na S3 (#1359), e a decisão anterior ("o áudio
 * não é reproduzido aqui") foi revertida de propósito: a história 7 do PRD
 * #1356 pede play NO HISTÓRICO, sem tirar o vendedor da tela em que ele está
 * trabalhando — e a thread da conversa é essa tela.
 *
 * As TRÊS andam juntas e nenhuma é opcional:
 *   recording_status         — sem ele, `recording_url` nulo volta a significar
 *                              as duas coisas que a S2 separou (não houve
 *                              gravação × ainda está vindo × falhou).
 *   recording_url            — o caminho do objeto. Não é URL assinada.
 *   recording_failure_reason — a causa, que é o que separa "falhou" de uma
 *                              parede muda.
 */
export const CONVERSATION_CALL_COLUMNS =
  "id, lead_id, direction, outcome, duration_seconds, phone_number, started_at, " +
  "recording_status, recording_url, recording_failure_reason";

export interface ConversationCall {
  id: string;
  lead_id: string | null;
  /** `inbound` | `outbound` — CHECK no banco. */
  direction: string;
  /**
   * Vocabulário do CHECK de `call_logs` (9 valores após a fundação TorqueCalls).
   * Fica como `string` de propósito: o rótulo é resolvido por consulta a
   * `OUTCOME_LABELS`, com fallback, então um valor novo no banco degrada em vez
   * de quebrar a thread.
   */
  outcome: string;
  duration_seconds: number | null;
  phone_number: string | null;
  started_at: string;
  /**
   * `null` | `processing` | `ready` | `failed` — CHECK no banco (S2, #1358).
   * Fica como `string | null` pelo mesmo motivo de `outcome`: um valor novo no
   * banco tem que degradar, não quebrar a thread. Quem interpreta é
   * `callRecordingState`.
   */
  recording_status: string | null;
  /** Caminho do objeto no bucket `call-recordings`. NÃO é URL assinada. */
  recording_url: string | null;
  /** Diagnóstico bruto do produtor quando `recording_status = 'failed'`. */
  recording_failure_reason: string | null;
}

export interface FetchConversationCallsParams {
  organizationId: string;
  /** Telefone da conversa, em qualquer formato — normalizado antes do filtro. */
  phoneNumber: string | null;
  /** Lead resolvido da conversa, quando existe. Segunda identidade. */
  leadId?: string | null;
}

/** Só aceita UUID canônico — o valor entra numa expressão `.or()` do PostgREST. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Todos os formatos em que o MESMO telefone pode ter sido gravado em
 * `call_logs.phone_number`.
 *
 * Existe porque o produtor **não garante** forma canônica. `call-plane.ts:260`
 * escolhe o peer assim:
 *
 * ```ts
 * peer = digitsOnly(lead.normalized_phone)
 *     || digitsOnly(lead.phone_digits)
 *     || digitsOnly(lead.phone);
 * ```
 *
 * O primeiro ramo é canônico, mas os dois fallbacks são `digitsOnly` de texto
 * cru: `'+55 48 9189-2653'` vira `'554891892653'` — com o `55` e sem o nono
 * dígito. A `CHECK` da coluna só exige "8 a 15 dígitos", e
 * `fn_voip_project_call_log` copia `peer_phone` **verbatim** para
 * `call_logs.phone_number`. Ou seja: nada no caminho normaliza.
 *
 * Confiar no formato faria a ligação sumir da conversa para todo lead cujo
 * `leads.normalized_phone` esteja nulo. Em vez de pressupor, comparamos o valor
 * canônico contra as quatro formas que `digitsOnly` de um telefone brasileiro
 * pode produzir.
 */
export function phoneVariants(canonical: string): string[] {
  const variantes = new Set<string>();
  const add = (v: string) => {
    if (v.length >= 8 && v.length <= 15) variantes.add(v);
  };

  add(canonical);
  add(`55${canonical}`);

  // Sem o nono dígito: o `9` que `normalizePhone` insere em número de 10
  // dígitos, e que o texto cru muitas vezes não tem.
  if (canonical.length === 11 && canonical[2] === "9") {
    const semNono = canonical.slice(0, 2) + canonical.slice(3);
    add(semNono);
    add(`55${semNono}`);
  }

  return [...variantes];
}

export async function fetchConversationCalls({
  organizationId,
  phoneNumber,
  leadId,
}: FetchConversationCallsParams): Promise<ConversationCall[]> {
  const normalized = normalizePhone(phoneNumber);

  // `normalized` é dígito puro (normalizePhone descarta o resto) e `leadId` é
  // validado como UUID — nenhum dos dois pode injetar vírgula ou parêntese e
  // reescrever o filtro do PostgREST.
  const identities: string[] = [];
  if (normalized) {
    for (const v of phoneVariants(normalized)) identities.push(`phone_number.eq.${v}`);
  }
  if (leadId && UUID_RE.test(leadId)) identities.push(`lead_id.eq.${leadId}`);

  if (identities.length === 0) return [];

  const { data, error } = await supabase
    .from("call_logs")
    .select(CONVERSATION_CALL_COLUMNS)
    .eq("organization_id", organizationId)
    .or(identities.join(","))
    // DESC + limit: mesma direção da janela das mensagens. Ver docblock.
    .order("started_at", { ascending: false })
    .limit(THREAD_MESSAGE_LIMIT);

  if (error) throw error;
  return ((data ?? []) as unknown as ConversationCall[]).reverse();
}

/** Uma ligação só "aconteceu" de verdade quando foi atendida. */
export function isCallConnected(outcome: string): boolean {
  return outcome === "connected";
}

/**
 * Duração legível. Devolve `null` quando não há duração a mostrar — chamada não
 * atendida tem `duration_seconds` nulo, e "0s" seria ruído com cara de dado.
 */
export function formatCallDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;

  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return m > 0 ? `${h}h ${String(m).padStart(2, "0")}min` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}min ${s}s` : `${m}min`;
  return `${s}s`;
}
