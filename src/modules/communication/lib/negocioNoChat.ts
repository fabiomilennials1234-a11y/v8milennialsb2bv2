/**
 * Seção "Negócios" no painel lateral do chat — piloto por organização.
 *
 * Até aqui o painel da conversa mostrava só a PESSOA (campos do lead, funis,
 * notas). Quem atende pelo chat precisava sair da conversa e abrir o funil
 * para saber quanto vale o negócio, de quem ele é e em que etapa está. A
 * Riofix pediu isso ao lado da conversa (30/09/2026).
 *
 * Liberado por lista de orgs, e não por plano, de propósito: é pedido de um
 * cliente, e ligar para todo o `torque-2.0` mudaria o painel de dezenas de
 * orgs que não pediram. Mesmo padrão de `MILENNIALS_ORG_ID` (analytics) e
 * `TOTH_ORDER_PILOT_ORG_ID` (integrations). Para abrir a outra org, basta
 * somar o id aqui; para todas, trocar o gate por `hasFeature`.
 */

/** Uma linha da seção "Negócios" do painel do chat. */
export interface NegocioDoChat {
  /** `pipeline_entries.id` — o que o Card do Negócio abre. */
  id: string;
  leadId: string;
  titulo: string;
  estado: "aberto" | "ganho" | "perdido";
  funil: string;
  funilCor: string;
  etapa: string;
  valor: number | null;
  dono: string | null;
  criadoEm: string | null;
  diasNaEtapa: number | null;
  /** Rota do board, ou `null` quando não há funil navegável. */
  caminho: string | null;
  /** Venda anterior ao CRM: não tem card para abrir. */
  vendaHistorica: boolean;
}

export const RIOFIX_ORG_ID = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";

const ORGS_COM_NEGOCIO_NO_CHAT: ReadonlySet<string> = new Set([RIOFIX_ORG_ID]);

export function mostraNegocioNoChat(organizationId: string | null | undefined): boolean {
  return !!organizationId && ORGS_COM_NEGOCIO_NO_CHAT.has(organizationId);
}

/**
 * O valor que o resumo exibe — a MESMA regra do Card do Negócio
 * (`contaDoNegocio`): itens, depois `deals.value`, depois o `sale_value` do
 * funil. Mostrar outra conta aqui faria o chat e o card discordarem sobre o
 * mesmo negócio. `null` = sem valor nenhum (a linha some, não vira "R$ 0").
 */
export function valorDoResumo(entrada: {
  totalDosItens: number | null;
  valorDoNegocio: number | null;
  valorDoFunil: number;
}): number | null {
  if (entrada.totalDosItens != null) return entrada.totalDosItens;
  if (entrada.valorDoNegocio != null) return entrada.valorDoNegocio;
  return entrada.valorDoFunil > 0 ? entrada.valorDoFunil : null;
}

/**
 * Abertos primeiro — é o que o atendente vai trabalhar —, depois os fechados.
 * Dentro de cada grupo, o mais recente no topo.
 */
export function ordenarNegociosDoChat<
  T extends { estado: "aberto" | "ganho" | "perdido"; criadoEm: string | null },
>(negocios: T[]): T[] {
  const peso = (n: T) => (n.estado === "aberto" ? 0 : 1);
  const tempo = (n: T) => (n.criadoEm ? new Date(n.criadoEm).getTime() || 0 : 0);
  return [...negocios].sort((a, b) => peso(a) - peso(b) || tempo(b) - tempo(a));
}
