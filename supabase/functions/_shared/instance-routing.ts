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
 *      `conversation` → a Instance da mensagem mais recente daquele telefone,
 *                       lida nas DUAS caixas: `whatsapp_messages` (chip) e
 *                       `channel_messages` (canal oficial).
 *   4. o recuo declarado no nó.
 *   5. falha `no_instance_resolved`.
 *
 * O canal oficial participa de TODOS os degraus (issue #1700). A exceção é o
 * atalho do degrau 2 quando a fixa declarada morreu — ver `deadPinShortcut`.
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

/**
 * Os chips — número comum, WhatsApp não-oficial.
 *
 * Deixou de ser o universo do roteamento no #1700 e passou a nomear um recorte
 * dentro dele. Sobrou em dois lugares, os dois com motivo próprio:
 *
 *  1. `deadPinShortcut` — o atalho do degrau 2 quando a fixa declarada morreu.
 *  2. `send_to_number`, que passa esta lista como `providers`: aquele nó manda
 *     para números avulsos, que nunca escreveram, e a janela de 24h da Meta
 *     está fechada por definição para eles.
 *
 * O nome antigo, "LEGACY", dizia isolamento de certificação Meta. Um número
 * `meta`/`meta_cloud` continua fora de tudo aqui; o que entrou é o canal
 * oficial via NotificaMe, que é outra coisa.
 */
export const LEGACY_PROVIDERS = ["uazapi", "evolution"];

/**
 * Os provedores que o roteamento do Workflow alcança (issue #1700).
 *
 * Até o #1690 o canal oficial era só **nomeável**: entrava no degrau 1, onde
 * uma pessoa escreveu o id do número no nó, e ficava fora dos degraus em que a
 * REGRA escolhe. Agora ele é **escolhível** — conta no atalho de "uma Instance
 * viva só", `conversation` e `responsible` resolvem nele, e ele pode ser o
 * recuo declarado.
 *
 * O que destravou isso foi o escape do #1689: fora da janela de 24 horas a Meta
 * recusa texto livre, e a recusa chega por callback, depois de o executor ter
 * dado o envio por bem-sucedido. Sem o escape, escolha automática pelo oficial
 * seria mensagem que some sem rastro. **Este módulo depende do #1689 estar no
 * ar** — o merge de um sem o outro é a perda silenciosa de volta.
 */
export const ROUTABLE_PROVIDERS = [...LEGACY_PROVIDERS, "notificame"];

/**
 * A linha de `whatsapp_instances` que o provider precisa, mais o que a regra lê.
 *
 * `organization_id` e o estreitamento de `provider` estão aqui porque a Instance
 * resolvida é entregue DIRETO aos helpers de envio, que pedem um
 * `WhatsAppInstance` — sem os dois campos declarados, os onze pontos de envio do
 * Workflow eram erro de tipo (`organization_id` ausente, `provider` largo demais).
 * Nada disso é promessa nova: as duas consultas que constroem este tipo fazem
 * `select("*")` filtrado por `organization_id` e por `provider IN (…)`, então a
 * coluna sempre veio preenchida e o provedor sempre foi um dos declarados. O
 * tipo é que omitia.
 *
 * ⚠️ ESTE ESTREITAMENTO NÃO É O PORTÃO, e a issue #1690 o leu como se fosse.
 * Alargá-lo não produz um único erro de compilação: os onze pontos de envio
 * entregam a linha a helpers tipados como `WhatsAppInstance`, cujo `provider`
 * já inclui `notificame`, e ninguém faz `switch` exaustivo sobre este campo.
 * O portão é o filtro `.in("provider", …)` nas duas consultas abaixo. Mexer no
 * tipo é descrever; mexer no filtro é decidir — e o compilador fica calado.
 */
export interface RoutedInstance {
  id: string;
  organization_id: string;
  instance_name: string;
  status: string | null;
  session_dead_since: string | null;
  provider: "evolution" | "uazapi" | "notificame";
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
 * **Roteável** = viva **e** de provedor que o roteamento alcança — os chips e o
 * canal oficial. Um número `meta`/`meta_cloud` pode estar perfeitamente vivo e
 * ainda assim nunca ser escolhido (isolamento de certificação).
 *
 * Espelhado no front por `isRoutableInstance`, e o gêmeo
 * `tests/unit/instance-routing-twin.test.ts` prende os dois: contar diferente
 * faria o painel prometer uma coisa e o envio fazer outra.
 */
export function isRoutableInstance(
  inst: Partial<RoutedInstance> | null | undefined,
): boolean {
  return isInstanceLive(inst) && ROUTABLE_PROVIDERS.includes(String(inst?.provider));
}

/**
 * **Chip** = viva e de provedor não-oficial. Recorte dentro de `isRoutable`,
 * usado só onde o canal oficial não serve — ver `LEGACY_PROVIDERS`.
 */
export function isChipInstance(
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
  /**
   * O universo de provedores que ESTE nó aceita. Default: `ROUTABLE_PROVIDERS`.
   *
   * Existe por causa de `send_to_number`, que passa `LEGACY_PROVIDERS`: aquele
   * nó manda para números avulsos — vendedores, gestores — que não são leads e
   * nunca escreveram, então a janela de 24 horas da Meta está fechada por
   * definição e o canal oficial recusaria o texto livre. O painel daquele nó já
   * recusa a opção; isto é a mesma recusa do lado do executor.
   */
  providers?: readonly string[];
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
  const providers = args.providers ?? ROUTABLE_PROVIDERS;
  const policy = readRoutingPolicy(node);

  // ── 1. fixed: o operador nomeou o número. ────────────────────────────────
  // A Instance existir e estar fora do ar é queda — quase sempre temporária —
  // e trocar de número por causa dela reintroduz o defeito. Falha.
  //
  // A Instance **não existir mais** é outra coisa: é configuração velha, de
  // instância recriada ou removida. O id morto no JSON não é uma declaração
  // válida, então o nó segue para o atalho de um número vivo e para o recuo
  // declarado — nunca para uma escolha do sistema, e nunca para a conversa do
  // Lead, que o operador recusou ao escolher `fixed`.
  //
  // Medido em produção (2026-08-02): 44 nós ativos em 3 organizações de um
  // número vivo só apontavam para instâncias inexistentes — Basic4u (35),
  // Itatex (6), SC Beauty (3). Falhar todas por causa de um id obsoleto é pior
  // do que usar o único número que a organização tem.
  const pinnedId = str(node.whatsappInstanceId);
  if (policy === "fixed") {
    const declared = await loadInstance(supabase, organizationId, pinnedId, providers);
    if (declared) return checkLive(declared);
  }

  // ── 2. Uma Instance viva só: não há escolha errada a proteger. ───────────
  // O defeito corrigido é escolher errado ENTRE várias opções. Com uma opção
  // só não existe outro número para o qual trocar, então usar essa não é
  // substituição — e recusar quebraria as 66 organizações de um número, que
  // nunca tiveram o problema. Vem antes da política de propósito: instância
  // recriada deixa a thread apontando para a antiga, extinta, e a org
  // continuaria funcionando com o único número que tem.
  //
  // Com o canal oficial escolhível (#1700) a contagem passou a incluí-lo — mas
  // NÃO quando a fixa declarada morreu. Ver `deadPinShortcut`: são 63 nós
  // ativos pendurados neste atalho, e 18 deles na única org que tem os dois
  // números.
  const live = await listRoutable(supabase, organizationId, providers);
  const atalho = policy === "fixed" ? deadPinShortcut(live) : live;
  if (atalho.length === 1) return { ok: true, instance: atalho[0] };
  if (live.length === 0) return await noLiveInstance(supabase, organizationId, providers);

  // ── 3. A política resolve. `fixed` não participa: quem nomeou um número
  //       não quer que a conversa do Lead escolha por ele. ─────────────────
  if (policy !== "fixed") {
    const resolved = policy === "responsible"
      ? await resolveByResponsible(supabase, organizationId, leadId, providers)
      : await resolveByConversation(supabase, organizationId, leadId, providers);

    if (resolved) return checkLive(resolved);
  }

  // ── 4. O recuo declarado no nó. ──────────────────────────────────────────
  const fallback = await loadInstance(
    supabase,
    organizationId,
    str(node.fallbackInstanceId),
    providers,
  );
  if (fallback) return checkLive(fallback);

  // ── 5. Sem resolução: falha em vez de sortear. ───────────────────────────
  if (policy === "fixed") {
    return fail(
      "no_instance_resolved",
      `O nó está configurado para um número fixo que não existe mais nesta organização${
        pinnedId ? ` (${pinnedId})` : ""
      }. Escolha outro número no nó.`,
    );
  }
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
 * O universo do atalho do degrau 2 quando a política é `fixed` — isto é, quando
 * o operador NOMEOU um número e ele não resolveu, porque o id morreu ou nunca
 * foi preenchido.
 *
 * ⚠️ ESTE É O RISCO CENTRAL DO #1700, e não é um detalhe.
 *
 * Medido em produção em 2026-08-20: **63 nós de envio ativos, em 9
 * organizações, apontam para instâncias que não existem mais, e NENHUM declara
 * recuo** — Basic4u 29, Chique 18, Itatex 6, SC Beauty 3, mais 5 orgs com 7.
 * Todos sobrevivem exclusivamente por este atalho. Os 12 ids mortos distintos
 * não deixaram rastro: zero têm linha sobrevivente em
 * `whatsapp_instance_secrets`, então o provedor de uma instância apagada é
 * irrecuperável e nenhuma regra pode "recuperar pelo mesmo provedor".
 *
 * A Chique é a única org com canal oficial e tem também um chip. Se o oficial
 * simplesmente entrasse na contagem, ela passaria de uma Instance viva para
 * duas, o atalho deixaria de disparar, `fixed` não participa do degrau 3, não
 * há recuo — e os **18 nós dela parariam de enviar no dia do deploy**. A
 * Basic4u tem 29 na mesma corda, esperando qualquer segundo número.
 *
 * Das três saídas levantadas no ticket — curar o dado por migration, estender o
 * atalho, ou falhar legível — esta é a segunda: **fixa morta mais exatamente um
 * chip vivo segue resolvendo no chip**. Não toca dado de cliente, não exige
 * saber o provedor do id morto, e preserva o comportamento de hoje exatamente:
 * antes do #1700 a contagem já era só de chips.
 *
 * A org **sem chip nenhum** cai no universo inteiro: lá o canal oficial é o
 * único número que existe, e recusá-lo seria recusar a organização inteira —
 * que é o critério "org só com canal oficial: o atalho o encontra".
 *
 * Isto NÃO é a máquina escolhendo sozinha. O recorte precisa ter exatamente um
 * elemento para que o atalho dispare; com dois chips vivos ele devolve dois, o
 * atalho não dispara, e o nó vai para o recuo declarado ou falha — como hoje.
 *
 * Exportado porque o painel do front precisa descrever este mesmo recorte no
 * aviso de fixa obsoleta ("hoje o envio sai por X"). O gêmeo
 * `tests/unit/instance-routing-twin.test.ts` prende as duas cópias.
 */
export function deadPinShortcut<T extends Partial<RoutedInstance>>(live: T[]): T[] {
  const chips = live.filter((i) => isChipInstance(i));
  return chips.length > 0 ? chips : live;
}

/**
 * A Instance da mensagem mais recente daquele telefone, em qualquer direção e
 * em qualquer das DUAS caixas: `whatsapp_messages`, do chip, e
 * `channel_messages`, do canal oficial (issue #1700). Ganha a mais recente das
 * duas — "o número em que o cliente escreveu" não tem opinião sobre em que
 * tabela a linha caiu.
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
  providers: readonly string[],
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

  const [chip, oficial] = await Promise.all([
    lastChipMessage(supabase, organizationId, phone),
    lastOfficialMessage(supabase, organizationId, phone, providers),
  ]);

  const vencedor = maisRecente(chip, oficial);
  return await loadInstance(supabase, organizationId, vencedor?.instanceId, providers);
}

/** Uma candidata a "última mensagem da thread": de qual Instance, e quando. */
interface ThreadHit {
  instanceId: string;
  at: number;
}

function maisRecente(a: ThreadHit | null, b: ThreadHit | null): ThreadHit | null {
  if (!a) return b;
  if (!b) return a;
  return b.at > a.at ? b : a;
}

function hit(instanceId: unknown, timestamp: unknown): ThreadHit | null {
  const id = str(instanceId);
  if (!id) return null;
  const at = Date.parse(String(timestamp));
  return { instanceId: id, at: Number.isNaN(at) ? 0 : at };
}

/** A última mensagem da thread na caixa do chip. */
async function lastChipMessage(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string,
): Promise<ThreadHit | null> {
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("instance_id, timestamp")
    .eq("organization_id", organizationId)
    .eq("normalized_phone", phone)
    .eq("is_group", false)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { instance_id?: unknown; timestamp?: unknown } | null;
  return row ? hit(row.instance_id, row.timestamp) : null;
}

/**
 * A última mensagem da thread na caixa do canal oficial (issue #1700).
 *
 * O oficial NÃO grava em `whatsapp_messages` — o provider dele grava a linha em
 * `channel_messages` por conta própria, e o #1699 tornou isso explícito com
 * `providerPersistsOwnMessages` justamente para não duplicar a conversa na
 * tela. Consequência: sem esta leitura, `conversation` seria cego para o número
 * oficial e a Chique responderia pelo chip a quem escreveu no oficial — o
 * defeito que o ADR-0025 existe para corrigir, de volta por outra porta.
 *
 * **Custo zero para quem só tem chip.** A leitura só acontece quando a
 * organização tem uma Instance de canal oficial: sem ela, `instanceIds` vem
 * vazio e a função devolve `null` sem consultar `channel_messages`. É o que
 * mantém os ~30 clientes de chip com comportamento idêntico ao de hoje.
 *
 * ⚠️ `channel_messages.phone_number` é CRU, não canônico: medido em produção,
 * as 36 linhas do canal oficial são só dígitos, prefixadas por 55, com 12 ou 13
 * caracteres — `554884398055` e `5555992382506`. `whatsapp_messages` tem a
 * coluna `normalized_phone`; esta tabela não tem nenhuma. Por isso a
 * comparação é por variantes do canônico, e não por igualdade direta.
 */
async function lastOfficialMessage(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string,
  providers: readonly string[],
): Promise<ThreadHit | null> {
  const instanceIds = await listOfficialInstanceIds(supabase, organizationId, providers);
  if (instanceIds.length === 0) return null;

  const { data } = await supabase
    .from("channel_messages")
    .select("instance_id, timestamp")
    .eq("organization_id", organizationId)
    .eq("channel", "whatsapp")
    .in("instance_id", instanceIds)
    .in("phone_number", phoneVariants(phone))
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { instance_id?: unknown; timestamp?: unknown } | null;
  return row ? hit(row.instance_id, row.timestamp) : null;
}

/**
 * As formas cruas com que o provedor pode ter gravado um telefone canônico.
 *
 * `leads.normalized_phone` é o que `normalize_brazilian_phone` produz: sem o
 * `55`, com o nono dígito acrescentado nos celulares de 10 dígitos. O provedor
 * grava o que a Meta entrega, que traz o `55` e pode não ter o nono dígito.
 * Desfazer as duas transformações dá no máximo quatro strings, todas cobertas
 * pelo índice `idx_channel_messages_conversation`.
 */
function phoneVariants(normalized: string): string[] {
  const variantes = new Set<string>([normalized, `55${normalized}`]);
  if (normalized.length === 11 && normalized[2] === "9") {
    const sem9 = normalized.slice(0, 2) + normalized.slice(3);
    variantes.add(sem9);
    variantes.add(`55${sem9}`);
  }
  return [...variantes];
}

/**
 * Os ids das Instances de canal oficial da Organization, vivas ou não.
 *
 * Vivas ou não de propósito: uma thread parada num oficial CAÍDO tem de fazer o
 * envio falhar com `instance_disconnected`, exatamente como uma thread parada
 * num chip caído. Filtrar por vivacidade aqui faria o nó trocar de número em
 * silêncio — o defeito que o ADR-0025 corrigiu.
 */
async function listOfficialInstanceIds(
  supabase: SupabaseClient,
  organizationId: string,
  providers: readonly string[],
): Promise<string[]> {
  const oficiais = providers.filter((p) => !LEGACY_PROVIDERS.includes(p));
  if (oficiais.length === 0) return [];

  const { data } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("organization_id", organizationId)
    .in("provider", oficiais);

  return ((data as { id?: unknown }[] | null) ?? [])
    .map((r) => str(r.id))
    .filter((id): id is string => id !== null);
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
  providers: readonly string[],
): Promise<RoutedInstance | null> {
  if (!leadId) return null;
  const result = await resolveLeadWriteInstance(supabase, leadId);
  if (!result.ok || !result.instance) return null;
  return await loadInstance(supabase, organizationId, result.instance.instanceId, providers);
}

// ============================================================================
// Helpers
// ============================================================================

function fail(code: InstanceRoutingErrorCode, message: string): RoutingResult {
  return { ok: false, code, message };
}

/**
 * Carrega uma Instance **da organização**, e apenas dos provedores declarados —
 * o filtro é ao mesmo tempo a fronteira do tenant e o isolamento Meta. Sem ele,
 * uma thread cuja última mensagem caiu num número `meta_cloud` rotearia um
 * envio do Workflow por ele.
 *
 * ⚠️ ESTE `.in("provider", …)` É O PORTÃO — junto com o de `listRoutable`.
 * Alargar o tipo `RoutedInstance.provider` descreve; alargar este filtro
 * decide, e o compilador fica calado nos dois casos.
 */
async function loadInstance(
  supabase: SupabaseClient,
  organizationId: string,
  instanceId: string | null | undefined,
  /** Quais provedores este nó aceita. Ver `ResolveRoutedInstanceArgs.providers`. */
  providers: readonly string[] = ROUTABLE_PROVIDERS,
): Promise<RoutedInstance | null> {
  if (!instanceId) return null;
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("id", instanceId)
    .eq("organization_id", organizationId)
    .in("provider", providers)
    .maybeSingle();
  return (data as RoutedInstance) ?? null;
}

/** As Instances roteáveis da Organization, no universo que o nó aceita. */
async function listRoutable(
  supabase: SupabaseClient,
  organizationId: string,
  providers: readonly string[] = ROUTABLE_PROVIDERS,
): Promise<RoutedInstance[]> {
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("organization_id", organizationId)
    .in("provider", providers)
    .in("status", CONNECTED);
  return ((data as RoutedInstance[]) ?? []).filter(
    (i) => isInstanceLive(i) && providers.includes(String(i.provider)),
  );
}

/**
 * Nenhuma Instance viva. Distingue "a organização nunca conectou um número" de
 * "os números caíram" — para as 66 orgs de um número, a segunda é o caso comum
 * e "nenhum número resolvido" seria uma mensagem enganosa.
 */
async function noLiveInstance(
  supabase: SupabaseClient,
  organizationId: string,
  providers: readonly string[] = ROUTABLE_PROVIDERS,
): Promise<RoutingResult> {
  const { count } = await supabase
    .from("whatsapp_instances")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("provider", providers);

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
