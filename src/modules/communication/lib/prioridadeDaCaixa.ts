/**
 * `prioridadeDaCaixa` — por qual caixa se começa a conversa com um lead.
 *
 * Uma regra, dois lugares: o seletor "Iniciar conversa por"
 * (`agruparConversasDoLead`) e o chat aberto sem `?instance=` num lead sem
 * histórico (`escolherCaixaSemConversa`). Quando eram duas regras, o seletor já
 * punha a caixa da vendedora no topo e o chat ainda abria na 1ª caixa em ordem
 * alfabética — a de outra vendedora (Chamado 52df972e).
 *
 * Admin e master enxergam TODAS as caixas da org; sem estes sinais a ordem
 * alfabética decide por eles.
 */

export interface SinaisDeQuemAtende {
  /** Preferência de caixa do usuário logado (`team_members`). */
  preferredInstanceId?: string | null;
  /** Caixas vinculadas ao usuário logado (`whatsapp_instance_allowed_members`). */
  minhasInstanceIds?: ReadonlyArray<string>;
  /** Caixas vinculadas ao responsável do lead. */
  doResponsavelInstanceIds?: ReadonlyArray<string>;
}

/**
 * 0 preferida · 1 minha e do responsável · 2 minha · 3 do responsável · 4 demais.
 *
 * "Minha e do responsável" vem antes das outras minhas: entre as caixas que o
 * usuário pode usar, a que também é do dono do lead mantém a conversa com quem
 * cuida dele.
 */
export function prioridadeDaCaixa({
  preferredInstanceId = null,
  minhasInstanceIds = [],
  doResponsavelInstanceIds = [],
}: SinaisDeQuemAtende): (instanceId: string) => number {
  const minhas = new Set(minhasInstanceIds);
  const doResponsavel = new Set(doResponsavelInstanceIds);
  return (instanceId) => {
    if (preferredInstanceId && instanceId === preferredInstanceId) return 0;
    if (minhas.has(instanceId)) return doResponsavel.has(instanceId) ? 1 : 2;
    if (doResponsavel.has(instanceId)) return 3;
    return 4;
  };
}
