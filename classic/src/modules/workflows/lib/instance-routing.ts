/**
 * Instance Routing Policy — a regra que o WhatsApp Message Node declara para
 * escolher a Instance de saída (PRD #1331, ADR-0025).
 *
 * Antes, o nó oferecia "Automático (primeira disponível)", que no backend
 * virava uma consulta sem ordenação — o Postgres devolvia qualquer Instance
 * conectada da Organization. O Lead escrevia para um número e recebia a
 * automação de outro. Aqui a escolha passa a ter nome e a ficar visível no
 * próprio nó.
 *
 * Compatibilidade com o nó legado: `whatsappInstanceId` preenchido sempre
 * significou "manda por esta Instance", então ele passa a ser a Instance da
 * política `fixed`. Vazio era o "Automático" aleatório, e vira `conversation`.
 * Nenhum dado precisa ser migrado para essa leitura funcionar.
 */

import type { ActionNodeData, InstanceRoutingPolicy } from "@/types/workflow";

export type { InstanceRoutingPolicy };

/**
 * Os campos de roteamento que vivem no `data` do nó.
 *
 * Derivado de `ActionNodeData` em vez de redeclarado: a forma do nó é uma só,
 * e duas cópias divergiriam em silêncio.
 */
export type InstanceRoutingFields = Pick<
  ActionNodeData,
  | "instanceRoutingPolicy"
  | "whatsappInstanceId"
  | "whatsappInstanceName"
  | "fallbackInstanceId"
  | "fallbackInstanceName"
>;

/**
 * Os tipos de ação que enviam WhatsApp e, por isso, declaram política de
 * roteamento — o nó unificado do ADR-0012 e os legados que seguem vivos no
 * executor. `send_campaign_message` entra: é um dos pontos de envio do Workflow
 * (PRD #1331), e ficar de fora o deixaria escolhendo número sozinho.
 */
export const INSTANCE_ROUTED_ACTION_TYPES = [
  "send_whatsapp_message",
  "send_whatsapp",
  "send_whatsapp_audio",
  "send_whatsapp_image",
  "send_whatsapp_video",
  "send_whatsapp_sticker",
  "send_whatsapp_document",
  "send_whatsapp_template",
  "send_campaign_message",
  "send_to_number",
] as const;

export function isInstanceRoutedAction(actionType: string): boolean {
  return (INSTANCE_ROUTED_ACTION_TYPES as readonly string[]).includes(actionType);
}

interface PolicySpec {
  label: string;
  /** Frase de apoio que descreve a regra, em uma linha. */
  blurb: string;
  /** Se a política precisa de um recuo declarado. */
  usesFallback: boolean;
}

/**
 * Uma descrição por política. Rótulo, frase de apoio e necessidade de recuo
 * moram juntos porque mudam juntos — espalhá-los em três `switch` faria a
 * política nova nascer incompleta em dois lugares.
 */
const POLICY_SPECS: Record<InstanceRoutingPolicy, PolicySpec> = {
  conversation: {
    label: "Seguir a conversa do lead",
    blurb:
      "Sai pelo número em que a conversa com o lead está viva. Sem conversa, usa o número de recuo.",
    usesFallback: true,
  },
  responsible: {
    label: "Instância do responsável",
    blurb:
      "Sai pelo número vinculado ao responsável pelo lead. Sem vínculo, usa o número de recuo.",
    usesFallback: true,
  },
  fixed: {
    label: "Número fixo",
    blurb: "Sai sempre por este número, mesmo que a conversa esteja em outro.",
    usesFallback: false,
  },
};

export const INSTANCE_ROUTING_POLICIES = Object.keys(
  POLICY_SPECS,
) as InstanceRoutingPolicy[];

/** Política aplicada quando o nó não declara nenhuma. */
export const DEFAULT_INSTANCE_ROUTING_POLICY: InstanceRoutingPolicy =
  "conversation";

export function instanceRoutingLabel(policy: InstanceRoutingPolicy): string {
  return POLICY_SPECS[policy].label;
}

/**
 * Os chips — número comum, WhatsApp não-oficial. Espelha `LEGACY_PROVIDERS` do
 * backend.
 *
 * Deixou de ser o universo do roteamento no #1700 e virou um recorte dentro
 * dele, usado onde o canal oficial não serve: o atalho de fixa morta e o nó
 * `send_to_number`.
 */
const LEGACY_PROVIDERS = ["uazapi", "evolution"];

/**
 * Os provedores que o roteamento do Workflow alcança (issue #1700). Espelha
 * `ROUTABLE_PROVIDERS` do backend.
 *
 * Números `meta`/`meta_cloud` continuam de fora (isolamento de certificação).
 * O canal oficial via NotificaMe entrou: ele é escolhível pela regra, não só
 * nomeável por uma pessoa.
 */
const ROUTABLE_PROVIDERS = [...LEGACY_PROVIDERS, "notificame"];

/** Canal oficial (Meta via NotificaMe). Só para rotular a opção na tela. */
export function isOfficialChannel(inst: { provider?: string | null }): boolean {
  return String(inst.provider) === "notificame";
}

/**
 * Uma Instance é elegível ao roteamento quando está conectada, sem sessão morta
 * e de provedor que o executor alcança. Mesma definição de
 * `isRoutableInstance` em `supabase/functions/_shared/instance-routing.ts`: se
 * o painel e o envio discordarem sobre quantos números vivos existem, o
 * operador vê um campo de recuo que o backend ignora — ou não vê o que ele
 * exige. O gêmeo `tests/unit/instance-routing-twin.test.ts` prende os dois.
 */
export function isRoutableInstance(inst: {
  status?: string | null;
  session_dead_since?: string | null;
  provider?: string | null;
}): boolean {
  return isLive(inst) && ROUTABLE_PROVIDERS.includes(String(inst.provider));
}

/** Vivacidade pura — saúde de sessão, sem opinião sobre provedor. */
function isLive(inst: { status?: string | null; session_dead_since?: string | null }): boolean {
  return (
    (inst.status === "connected" || inst.status === "open") &&
    inst.session_dead_since == null
  );
}

/**
 * **Chip** = viva e de provedor não-oficial. Espelha `isChipInstance` do
 * backend.
 *
 * O painel precisa desta contagem em dois lugares, e os dois espelham uma
 * decisão do executor:
 *
 *  - `send_to_number`, que nunca oferece o canal oficial (a janela de 24h
 *    daqueles números está fechada por definição);
 *  - o aviso de fixa obsoleta, que descreve o `deadPinShortcut` do executor —
 *    com a fixa morta, o atalho conta só chips. Contar diferente aqui faria o
 *    aviso mentir sobre por onde o envio sai hoje.
 */
export function isChipInstance(inst: {
  status?: string | null;
  session_dead_since?: string | null;
  provider?: string | null;
}): boolean {
  return isLive(inst) && LEGACY_PROVIDERS.includes(String(inst.provider));
}

/**
 * O recorte que o executor usa no atalho de "uma Instance viva só" quando a
 * política é `fixed` e a fixa declarada não resolveu — porque o id morreu ou
 * nunca foi preenchido. Espelha `deadPinShortcut` do backend.
 *
 * Medido em 2026-08-20: 63 nós de envio ativos em 9 organizações apontam para
 * instâncias que não existem mais, e nenhum declara recuo. Todos sobrevivem por
 * este atalho. Com o canal oficial escolhível (#1700), contá-lo aqui levaria a
 * Chique de uma Instance viva para duas e derrubaria os 18 nós dela — por isso
 * o recorte é de chips, e só cai no universo inteiro quando a organização não
 * tem chip nenhum.
 *
 * O painel usa isto para dizer a verdade no aviso de fixa obsoleta. Se ele
 * contasse diferente, o aviso prometeria um número que o envio não usaria.
 */
export function deadPinShortcut<T extends {
  status?: string | null;
  session_dead_since?: string | null;
  provider?: string | null;
}>(live: T[]): T[] {
  const chips = live.filter((i) => isChipInstance(i));
  return chips.length > 0 ? chips : live;
}

function isPolicy(value: unknown): value is InstanceRoutingPolicy {
  return typeof value === "string" && value in POLICY_SPECS;
}

/**
 * Lê a política do nó, resolvendo o legado.
 *
 * Valor desconhecido cai no padrão em vez de vazar adiante — um nó com
 * política corrompida deve seguir a conversa do Lead, nunca sortear.
 */
export function readRoutingPolicy(
  data: InstanceRoutingFields,
): InstanceRoutingPolicy {
  if (isPolicy(data.instanceRoutingPolicy)) return data.instanceRoutingPolicy;
  if (data.whatsappInstanceId) return "fixed";
  return DEFAULT_INSTANCE_ROUTING_POLICY;
}

/**
 * Patch de troca de política.
 *
 * Sair de `fixed` apaga a Instance fixa: ela deixou de pertencer à política
 * ativa, e um id órfão no `data` traria de volta um valor invisível decidindo
 * o número de saída.
 *
 * Entrar em `fixed` **preserva** o recuo. Ele some da tela porque a política
 * não o usa, mas apagá-lo faria um ida-e-volta `conversation → fixed →
 * conversation` destruir em silêncio um recuo que o operador declarou — ou,
 * pior, o recuo semeado nas orgs multi-instância (#1333).
 */
export function buildPolicyChange(
  policy: InstanceRoutingPolicy,
): Partial<InstanceRoutingFields> {
  if (policy === "fixed") {
    return { instanceRoutingPolicy: "fixed" };
  }
  return {
    instanceRoutingPolicy: policy,
    whatsappInstanceId: "",
    whatsappInstanceName: "",
  };
}

/** Patch de escolha da Instance fixa — fixa a política junto. */
export function buildFixedInstanceChange(
  instanceId: string,
  instanceName: string,
): Partial<InstanceRoutingFields> {
  return {
    instanceRoutingPolicy: "fixed",
    whatsappInstanceId: instanceId,
    whatsappInstanceName: instanceName,
  };
}

/** Patch de escolha do recuo — não mexe na política ativa. */
export function buildFallbackChange(
  instanceId: string,
  instanceName: string,
): Partial<InstanceRoutingFields> {
  return {
    fallbackInstanceId: instanceId,
    fallbackInstanceName: instanceName,
  };
}

/** Se a política precisa de um recuo declarado. */
export function policyUsesFallback(policy: InstanceRoutingPolicy): boolean {
  return POLICY_SPECS[policy].usesFallback;
}

/**
 * Frase de apoio que descreve a regra ativa, em uma linha.
 *
 * Com um número conectado só, as políticas que dependem de resolução caem
 * todas no mesmo lugar e vale dizer isso. `fixed` continua descrevendo a si
 * mesma — ela nomeia um número, não resolve nenhum.
 */
export function describeRoutingPolicy(
  policy: InstanceRoutingPolicy,
  opts: { hasSingleInstance?: boolean } = {},
): string {
  if (opts.hasSingleInstance && policy !== "fixed") {
    return "A organização tem um número conectado — todas as mensagens saem por ele.";
  }
  return POLICY_SPECS[policy].blurb;
}
