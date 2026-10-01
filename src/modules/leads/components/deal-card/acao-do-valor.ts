import type { DealCardData, DealCardStage } from "./types";

/**
 * O que o bloco "Valor do negócio" pode oferecer — decidido num lugar só.
 *
 * ── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 * Desde 03/09 arrastar o card para a etapa de ganho NÃO registra venda: a
 * etapa deixou de decidir desfecho, que virou fato do negócio (ADR-0023
 * Emenda 1). Sobraram cards parados em "Vendido" sem negócio nenhum (Riofix:
 * 6 em "Vendido", 17 em "Perdido" sem `deal_id`).
 *
 * Nesses cards a tela oferecia "Definir valor", e `editar_valor_proposta`
 * recusa por desenho (20271021000011): entrada sem negócio em etapa com
 * `is_final_positive`/`is_final_negative` não recebe valor manual, e negócio
 * encerrado também não. O clique terminava em "Somente propostas abertas podem
 * receber valor manual" — um botão que só existe para falhar.
 *
 * A recusa é a regra certa; o defeito era oferecer o botão. E no card sem
 * negócio em "Vendido" a pergunta da pessoa não é "quanto vale esta proposta",
 * é "quanto eu vendi" — então ali o bloco oferece **registrar a venda com o
 * valor**, pelo mesmo caminho do botão Ganho (`definir_desfecho_da_entrada`,
 * que materializa o negócio e grava desfecho e valor na mesma escrita).
 *
 *   - negócio ganho ou perdido           → nada (o banco recusa; reabrir é o caminho)
 *   - negócio aberto, qualquer etapa     → "editar" (o banco aceita)
 *   - sem negócio, etapa "ganho"         → "registrar-venda"
 *   - sem negócio, etapa "perdido"       → nada (o banco recusa)
 *   - sem negócio, etapa "reuniao-final" → nada (o banco recusa; venda seria mentira)
 *   - sem negócio, etapa não-final       → "editar" (materializa e grava)
 *
 * Negócio aberto em etapa de ganho fica em "editar" de propósito: há org com
 * etapa intermediária marcada `is_final_positive` (testevideo, "negociação",
 * 5 negócios abertos), e trocar o botão ali obrigaria a fechar a venda só para
 * ajustar o preço.
 */
export type AcaoDoValor = "editar" | "registrar-venda" | null;

/**
 * Terminal aos olhos do BANCO — não da régua (`papel`). É a única fonte do
 * campo `DealCardStage.terminal`, e por isso mora aqui, puro e testável.
 *
 * `editar_valor_proposta` recusa valor manual em entrada sem negócio quando a
 * etapa tem QUALQUER uma das flags `is_final_*`, e funil pré-governança usa a
 * flag com `stage_role='open'` (Riofix: "Vendido"). Ler só o role deixava o
 * bloco oferecer um "Definir valor" que sempre falha.
 *
 * Mas a flag positiva NÃO quer dizer venda sempre: 263 entradas sem negócio
 * em prod estão em etapas `is_final_positive` de REUNIÃO ("Agendado ✓" com
 * `meeting_booked`, "Compareceu ✓" com `meeting_held`) — o "final" ali é da
 * etapa de agendamento, não do negócio. Promovê-las a "ganho" ofereceria
 * "Registrar venda" num card de reunião e gravaria no caderno de vendas, que é
 * append-only. Por isso a flag positiva só vira "ganho" quando o role não diz
 * outra coisa (`null`/`open`); com role de reunião vira "reuniao-final": o
 * banco recusa o valor e a tela não oferece nada.
 *
 * Ordem: o role terminal vence; a flag negativa vem antes da positiva (as duas
 * recusam, e "perdido" é a leitura conservadora).
 */
export function terminalDaEtapa(
  role: unknown,
  finalPositivo: unknown,
  finalNegativo: unknown,
): DealCardStage["terminal"] {
  if (role === "won") return "ganho";
  if (role === "lost") return "perdido";
  if (finalNegativo === true) return "perdido";
  if (finalPositivo === true) {
    return role === null || role === undefined || role === "open" ? "ganho" : "reuniao-final";
  }
  return null;
}

/** `terminal` é o que o banco consulta; sem ele (fixture, preview), o `papel`. */
function terminalDa(etapa: DealCardStage | undefined): DealCardStage["terminal"] {
  if (!etapa) return null;
  if (etapa.terminal !== undefined) return etapa.terminal;
  return etapa.papel === "aberto" ? null : etapa.papel;
}

export function acaoDoValor(
  negocio: Pick<DealCardData, "estado" | "dealId" | "etapas" | "etapaAtual">,
): AcaoDoValor {
  if (negocio.estado !== "aberto") return null;
  if (negocio.dealId) return "editar";
  // Pela chave de LEITURA: `etapaAtual` é o `stage_key` da entry (ver `chaveEntry`).
  const terminal = terminalDa(negocio.etapas.find((e) => e.chaveEntry === negocio.etapaAtual));
  if (terminal === "ganho") return "registrar-venda";
  if (terminal === null) return "editar";
  return null; // "perdido" e "reuniao-final": o banco recusa valor manual
}

/**
 * O "Registrar venda" do painel, sem o painel. `definirDesfecho` engole o erro
 * (vira toast lá dentro) e responde `false`; o bloco de valor precisa de um
 * `throw` para não fechar o campo e apagar o número digitado. Extraído para ser
 * testável sem montar `DealCardPanel`, que exige provider de sheet, de org, de
 * react-query e o client do banco.
 */
export function registrarVendaPor(
  definirDesfecho: (desfecho: "won", valor: number) => Promise<boolean>,
): (valor: number) => Promise<void> {
  return async (valor) => {
    if (!(await definirDesfecho("won", valor))) throw new Error("venda-nao-registrada");
  };
}
