/**
 * Query canônica de mensagens de uma conversa WhatsApp.
 *
 * Fonte única usada por `useWhatsAppMessages` (inbox + bubble) e por
 * `prefetchChatData` — qualquer divergência entre os dois causava refetch
 * duplicado E, historicamente, o bug de "mensagens somem".
 *
 * ── Por que filtrar por `normalized_phone` e não por `phone_number` ──
 * A mesma pessoa tem mensagens gravadas em MAIS DE UM formato de
 * `phone_number` na tabela: o webhook inbound grava o JID normalizado da
 * Uazapi (`55` + DDD + número), enquanto o primeiro outbound (copilot/manual,
 * antes do lead responder) grava o `lead.phone` cru — que muitas orgs guardam
 * SEM o `55`. Resultado: `.eq("phone_number", <um formato>)` só devolvia
 * metade da thread (a que casava o formato exato), e o realtime — que casa por
 * telefone NORMALIZADO — inseria mensagens que o refetch depois apagava.
 *
 * A coluna `normalized_phone` (trigger `normalize_brazilian_phone`, 100%
 * populada — 1.6M linhas, 0 nulos) colapsa todos os formatos numa identidade
 * única. Filtrar por ela devolve a thread inteira, independentemente do
 * formato de origem, e alinha o fetch ao realtime (que já usa `normalizePhone`
 * de `@/lib/normalizePhone`, espelho fiel da função do Postgres).
 *
 * ── Por que a janela é DESC + limit, e não "a thread inteira" ──
 * O PostgREST de prod está com `max_rows = 1000`. A versão anterior desta
 * query pedia `order("timestamp", asc)` SEM `.limit()`, acreditando carregar a
 * thread inteira num único fetch; na prática o gateway cortava em 1000 linhas
 * **sem erro nenhum** — e, com a ordem ASCENDENTE, o que sobrava eram as 1000
 * mensagens MAIS ANTIGAS. Toda conversa acima do teto ficava congelada numa
 * data passada, enquanto o realtime seguia colando as mensagens novas no fim:
 * a thread abria com um buraco no meio.
 *
 * Medido em prod (2026-08-06): 265 threads acima de 1000 mensagens, em 19
 * orgs, 554.662 mensagens fora da janela. Caso do chamado (Chique
 * Distribuidora): thread de 1272 mensagens parava em 31/07 e escondia as 272
 * mais recentes.
 *
 * Agora a janela é explícita e ancorada no fim da conversa: ordena DESC,
 * `.limit(THREAD_MESSAGE_LIMIT)` e reverte no cliente para devolver ASC. O
 * corte passa a ser deliberado e cai onde importa menos — nas mensagens mais
 * antigas, como em qualquer app de mensagem. `created_at` entra como segundo
 * critério porque `timestamp` tem precisão de segundo e empata: sem desempate
 * estável, a fronteira da janela variava entre um refetch e outro.
 *
 * ⚠️ Enquanto não existir "carregar mensagens anteriores" na UI, o que passa
 * de `THREAD_MESSAGE_LIMIT` fica inalcançável na tela (segue no banco). A
 * paginação é o passo seguinte — e, quando vier, a janela das ligações em
 * `conversationCallsQuery.ts` tem que andar junto.
 *
 * ── Por que a instância virou um CONJUNTO, e por que o chip fica na chave ──
 * O terceiro sabor de "mensagem sumiu" não era formato nem janela: era o
 * `.eq("instance_id", <instância viva>)`. Excluir uma instância desatava todo o
 * histórico dela (FK `ON DELETE SET NULL`) e a conversa inteira saía da tela —
 * 385.828 linhas órfãs em prod (2026-08-10), com excluir→recriar acontecendo em
 * menos de dois minutos. A saída é tirar `instance_id` do ciclo de vida da
 * Instance: o uuid passa a ser identificador HISTÓRICO — quem dropa a FK é a
 * migration `20270811000010_whatsapp_messages_drop_instance_fk.sql` — e a leitura
 * deixa de ser de UMA instância pra varrer o CHIP: instância viva + as que já
 * morreram no mesmo número (`resolveChipInstanceIds`).
 *
 * ⚠️ Essa varredura DEPENDE da migration, que é passo MANUAL, enquanto este
 * arquivo sobe sozinho no merge pra `main`. Enquanto ela não estiver aplicada
 * em prod, `whatsapp_chip_instance_ids` não existe, `resolveChipInstanceIds`
 * degrada pro conjunto `[instância viva]` e esta query se comporta exatamente
 * como a versão `.eq("instance_id", …)` de antes — nem melhor, nem pior. O
 * porquê da degradação está em `chipInstanceIds.ts`.
 *
 * O que NÃO muda é a identidade da thread: continua `(org, chip, telefone)`. A
 * tentação era tirar o chip da chave e unir tudo por telefone — só que org com
 * chips departamentais (uma delas tem 55) fala com o MESMO contato por números
 * diferentes, e 87% das conversas órfãs dela são tocadas por 2+ chips. Sem o
 * chip na chave, FINANCEIRO e TÉCNICA viram uma conversa só.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";
import { resolveChipInstanceIds } from "@/modules/communication/lib/chipInstanceIds";
import type { WhatsAppMessage } from "@/modules/communication/hooks/chat/types";

/** Colunas devolvidas pra o chat. Mantém em sync hook + prefetch. */
export const WHATSAPP_MESSAGE_COLUMNS =
  "id, organization_id, instance_id, message_id, remote_jid, phone_number, direction, message_type, content, media_url, media_expired, push_name, status, lead_id, timestamp, created_at, sent_by_ai, sent_source, is_group";

/**
 * Tamanho da janela da thread, ancorada na mensagem mais recente.
 *
 * Igual ao `max_rows` do PostgREST de prod (1000) de propósito: pedir mais não
 * traria mais — o gateway cortaria de novo, e de novo em silêncio.
 */
export const THREAD_MESSAGE_LIMIT = 1000;

export interface FetchConversationMessagesParams {
  organizationId: string;
  instanceId: string;
  /** Telefone em qualquer formato — é normalizado antes do filtro. */
  phoneNumber: string;
}

/**
 * Busca as `THREAD_MESSAGE_LIMIT` mensagens mais recentes de uma conversa
 * (org + chip + telefone) e devolve em ordem cronológica ascendente.
 * Filtra por `normalized_phone` pra capturar a thread inteira mesmo com
 * formatos divergentes de `phone_number`, e pelo conjunto de `instance_id` que
 * `resolveChipInstanceIds` devolver pro chip, pra não perder o que ficou pra
 * trás numa instância excluída.
 */
export async function fetchConversationMessages(
  params: FetchConversationMessagesParams,
): Promise<WhatsAppMessage[]> {
  const { organizationId, instanceId, phoneNumber } = params;

  const normalized = normalizePhone(phoneNumber);
  // Telefone impossível de normalizar (vazio/inválido) → sem conversa.
  if (!normalized) return [];

  // Degrada pra `[instanceId]` se a RPC ainda não existe em prod — ver
  // `chipInstanceIds.ts`. Nunca rejeita, então não precisa de guarda aqui.
  const instanceIds = await resolveChipInstanceIds(organizationId, instanceId);

  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select(WHATSAPP_MESSAGE_COLUMNS)
    .eq("organization_id", organizationId)
    .in("instance_id", [...instanceIds])
    .eq("normalized_phone", normalized)
    // DESC + limit = a janela cai nas MAIS RECENTES. Ver docblock.
    .order("timestamp", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(THREAD_MESSAGE_LIMIT);

  if (error) throw error;
  // O resto da UI (auto-scroll, divisor de não-lidas, merge com ligações)
  // assume ordem ascendente — desfaz o DESC que só serviu pra ancorar a janela.
  return ((data ?? []) as WhatsAppMessage[]).reverse();
}
