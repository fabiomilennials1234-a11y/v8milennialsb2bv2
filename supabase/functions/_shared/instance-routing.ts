/**
 * instance-routing — resolve de qual Instance o nó de mensagem do Workflow
 * envia (PRD #1331 / issue #1335, ADR-0025).
 *
 * O que existia antes: as Instances vivas da Organization ordenadas por
 * `last_connection_at` e a primeira levava. Determinístico, mas sem nenhuma
 * relação com o Lead — ele escrevia para um número e recebia a automação de
 * outro, e a escolha mudava sozinha quando outro número reconectava.
 *
 * Agora o nó **declara** a regra e esta função a executa. Ela nunca escolhe
 * sozinha: ou a regra resolve, ou o envio falha com um código legível.
 *
 * Ordem:
 *   1. `fixed`        → a Instance nomeada no nó. Fim, sem substituição.
 *   2. org com uma Instance viva só → é ela, antes de resolver qualquer coisa.
 *      Não é substituição: não existe outro número para o qual trocar.
 *   3. `responsible`  → a Instance vinculada ao responsável pelo Lead.
 *      `conversation` → a Instance da mensagem mais recente daquele telefone.
 *   4. o recuo declarado no nó.
 *   5. falha `no_instance_resolved`.
 *
 * Resolvida a Instance, ela é verificada: sessão morta ou desconectada faz o
 * envio **falhar** (`instance_disconnected`), sem retentativa e **sem trocar de
 * número**. Trocar por causa de uma queda de dez minutos reintroduziria o
 * defeito que esta função existe para corrigir.
 *
 * Falha **não** é exceção: o contrato é Result-like, como em
 * `instance-write-guard.ts`. Caminho esperado não lança.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveLeadWriteInstance } from "./instance-write-guard.ts";

export type InstanceRoutingPolicy = "conversation" | "responsible" | "fixed";

export type InstanceRoutingErrorCode =
  | "instance_disconnected"
  | "no_instance_resolved";

const CONNECTED = ["open", "connected"];

/** Meta isolation (cert Rule 2): um número Meta nunca é escolhido para envio legado. */
export const LEGACY_PROVIDERS = ["uazapi", "evolution"];

/**
 * A linha de `whatsapp_instances` que o provider precisa, mais o que a regra lê.
 *
 * `organization_id` e o estreitamento de `provider` estão aqui porque a Instance
 * resolvida é entregue DIRETO aos helpers de envio, que pedem um
 * `WhatsAppInstance` — sem os dois campos declarados, os onze pontos de envio do
 * Workflow eram erro de tipo (`organization_id` ausente, `provider` largo demais).
 * Nada disso é promessa nova: as duas consultas que constroem este tipo fazem
 * `select("*")` filtrado por `organization_id` e por `provider IN (LEGACY_PROVIDERS)`,
 * então a coluna sempre veio preenchida e o provedor sempre foi um dos legados.
 * O tipo é que omitia.
 */
export interface RoutedInstance {
  id: string;
  organization_id: string;
  instance_name: string;
  status: string | null;
  session_dead_since: string | null;
  provider: "evolution" | "uazapi";
  [column: string]: unknown;
}

export type RoutingResult =
  | { ok: true; instance: RoutedInstance }
  | { ok: false; code: InstanceRoutingErrorCode; message: string };

/**
 * Uma Instance está **viva** quando o webhook do provedor a reporta conectada e
 * o watchdog não registrou sessão morta.
 *
 * `status` sozinho engana: congela em "connected" depois de um logout remoto
 * feito de outro aparelho. O veredito real é `session_dead_since`, gravado por
 * `whatsapp-session-watchdog`. Espelha `deriveInstanceStatus()` no front.
 *
 * Vivacidade é saúde de sessão e nada mais — o provedor é outro eixo, ver
 * `isRoutableInstance`.
 */
export function isInstanceLive(
  inst: Partial<RoutedInstance> | null | undefined,
): boolean {
  if (!inst) return false;
  return CONNECTED.includes(String(inst.status)) && inst.session_dead_since == null;
}

/**
 * **Roteável** = viva **e** de provedor legado. Um número Meta pode estar
 * perfeitamente vivo e ainda assim nunca ser escolhido para um envio legado
 * (isolamento de certificação).
 */
export function isRoutableInstance(
  inst: Partial<RoutedInstance> | null | undefined,
): boolean {
  return isInstanceLive(inst) && LEGACY_PROVIDERS.includes(String(inst?.provider));
}

/**
 * Os campos de roteamento gravados no `data` do nó.
 *
 * Aceita o `params` cru do handler (um saco de propriedades do nó), por isso a
 * assinatura de índice e a leitura defensiva em `str()`.
 */
export interface RoutingNodeConfig {
  instanceRoutingPolicy?: unknown;
  /** Instance da política `fixed`. Campo legado, semântica preservada. */
  whatsappInstanceId?: unknown;
  fallbackInstanceId?: unknown;
  [key: string]: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export interface ResolveRoutedInstanceArgs {
  organizationId: string;
  leadId: string | null | undefined;
  node: RoutingNodeConfig;
}

/**
 * Lê a política do nó, resolvendo o legado.
 *
 * `whatsappInstanceId` sempre significou "manda por esta Instance", então vira
 * `fixed`. Vazio era o "Automático" aleatório, e vira `conversation`. Política
 * desconhecida cai no padrão em vez de vazar — um nó corrompido deve seguir a
 * conversa do Lead, nunca sortear.
 *
 * Espelha `src/modules/workflows/lib/instance-routing.ts` no front. As duas
 * leituras precisam concordar: o operador declara lá e o envio acontece aqui.
 */
export function readRoutingPolicy(node: RoutingNodeConfig): InstanceRoutingPolicy {
  const declared = str(node.instanceRoutingPolicy);
  if (declared === "conversation" || declared === "responsible" || declared === "fixed") {
    return declared;
  }
  if (str(node.whatsappInstanceId)) return "fixed";
  return "conversation";
}

// ============================================================================
// Resolução
// ============================================================================

export async function resolveRoutedInstance(
  supabase: SupabaseClient,
  args: ResolveRoutedInstanceArgs,
): Promise<RoutingResult> {
  const { organizationId, leadId, node } = args;
  const policy = readRoutingPolicy(node);

  // ── 1. fixed: o operador nomeou o número. Sem substituição, nunca. ────────
  if (policy === "fixed") {
    const declared = await loadInstance(supabase, organizationId, str(node.whatsappInstanceId));
    if (!declared) {
      return fail(
        "no_instance_resolved",
        "O nó está configurado para um número fixo que não existe mais nesta organização.",
      );
    }
    return checkLive(declared);
  }

  // ── 2. Uma Instance viva só: não há escolha errada a proteger. ───────────
  // O defeito corrigido é escolher errado ENTRE várias opções. Com uma opção
  // só não existe outro número para o qual trocar, então usar essa não é
  // substituição — e recusar quebraria as 66 organizações de um número, que
  // nunca tiveram o problema. Vem antes da política de propósito: instância
  // recriada deixa a thread apontando para a antiga, extinta, e a org
  // continuaria funcionando com o único número que tem.
  const live = await listRoutable(supabase, organizationId);
  if (live.length === 1) return { ok: true, instance: live[0] };
  if (live.length === 0) return await noLiveInstance(supabase, organizationId);

  // ── 3. A política resolve. ───────────────────────────────────────────────
  const resolved = policy === "responsible"
    ? await resolveByResponsible(supabase, organizationId, leadId)
    : await resolveByConversation(supabase, organizationId, leadId);

  if (resolved) return checkLive(resolved);

  // ── 4. O recuo declarado no nó. ──────────────────────────────────────────
  const fallback = await loadInstance(supabase, organizationId, str(node.fallbackInstanceId));
  if (fallback) return checkLive(fallback);

  // ── 5. Sem resolução: falha em vez de sortear. ───────────────────────────
  return fail(
    "no_instance_resolved",
    policy === "responsible"
      ? "O responsável pelo lead não tem número vinculado e o nó não declara um número de recuo."
      : "O lead ainda não trocou nenhuma mensagem e o nó não declara um número de recuo.",
  );
}

// ============================================================================
// Passos
// ============================================================================

/**
 * A Instance da mensagem mais recente daquele telefone, em qualquer direção.
 *
 * Mensagem de saída conta: o primeiro nó do funil abre a thread e os nós
 * seguintes a herdam, inclusive para Lead que nunca escreveu.
 *
 * A leitura é por `normalized_phone` do Lead — a forma canônica que o mesmo
 * `normalize_brazilian_phone` do banco produz nas duas pontas. **Nunca por
 * `lead_id`**: 52% das mensagens 1:1 em produção não o carregam, e ler por ele
 * erraria metade das threads.
 */
async function resolveByConversation(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string | null | undefined,
): Promise<RoutedInstance | null> {
  if (!leadId) return null;

  const { data: lead } = await supabase
    .from("leads")
    .select("normalized_phone")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const phone = str((lead as { normalized_phone?: unknown } | null)?.normalized_phone);
  if (!phone) return null;

  const { data: last } = await supabase
    .from("whatsapp_messages")
    .select("instance_id")
    .eq("organization_id", organizationId)
    .eq("normalized_phone", phone)
    .eq("is_group", false)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  return await loadInstance(
    supabase,
    organizationId,
    str((last as { instance_id?: unknown } | null)?.instance_id),
  );
}

/**
 * A Instance vinculada ao responsável pelo Lead.
 *
 * Reusa `resolveLeadWriteInstance` do vínculo user→instância em vez de
 * rederivar a regra. A diferença é que aqui ela roda porque **o nó declarou** a
 * política, não porque a flag `user_write_instance_strict` está ligada.
 */
async function resolveByResponsible(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string | null | undefined,
): Promise<RoutedInstance | null> {
  if (!leadId) return null;
  const result = await resolveLeadWriteInstance(supabase, leadId);
  if (!result.ok || !result.instance) return null;
  return await loadInstance(supabase, organizationId, result.instance.instanceId);
}

// ============================================================================
// Helpers
// ============================================================================

function fail(code: InstanceRoutingErrorCode, message: string): RoutingResult {
  return { ok: false, code, message };
}

/**
 * Carrega uma Instance **da organização**, e apenas de provedor legado — o
 * filtro é ao mesmo tempo a fronteira do tenant e o isolamento Meta. Sem ele,
 * uma thread cuja última mensagem caiu num número Meta rotearia um envio legado
 * por ele.
 */
async function loadInstance(
  supabase: SupabaseClient,
  organizationId: string,
  instanceId: string | null | undefined,
): Promise<RoutedInstance | null> {
  if (!instanceId) return null;
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("id", instanceId)
    .eq("organization_id", organizationId)
    .in("provider", LEGACY_PROVIDERS)
    .maybeSingle();
  return (data as RoutedInstance) ?? null;
}

/** As Instances roteáveis da Organization. */
async function listRoutable(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<RoutedInstance[]> {
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("organization_id", organizationId)
    .in("provider", LEGACY_PROVIDERS)
    .in("status", CONNECTED);
  return ((data as RoutedInstance[]) ?? []).filter(isRoutableInstance);
}

/**
 * Nenhuma Instance viva. Distingue "a organização nunca conectou um número" de
 * "os números caíram" — para as 66 orgs de um número, a segunda é o caso comum
 * e "nenhum número resolvido" seria uma mensagem enganosa.
 */
async function noLiveInstance(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<RoutingResult> {
  const { count } = await supabase
    .from("whatsapp_instances")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("provider", LEGACY_PROVIDERS);

  return (count ?? 0) > 0
    ? fail(
        "instance_disconnected",
        "Todos os números de WhatsApp da organização estão desconectados. Reconecte e repita a execução.",
      )
    : fail(
        "no_instance_resolved",
        "A organização não tem nenhum número de WhatsApp conectado.",
      );
}

/**
 * Instance fora do ar falha o envio, com o nome dela na mensagem para a tela
 * Automações → Execuções. Sem retentativa e sem trocar de número: a queda é
 * quase sempre temporária, e substituir o número entrega o pior dos dois
 * mundos — o cliente estranha e o número novo esquenta sozinho.
 */
function checkLive(instance: RoutedInstance): RoutingResult {
  if (!isInstanceLive(instance)) {
    return fail(
      "instance_disconnected",
      `O número "${instance.instance_name}" está desconectado. A automação não trocou de número — reconecte e repita a execução.`,
    );
  }
  return { ok: true, instance };
}
