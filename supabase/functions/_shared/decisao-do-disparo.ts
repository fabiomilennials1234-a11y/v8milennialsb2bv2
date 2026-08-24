/**
 * decisao-do-disparo — enviar, pular ou recusar, num lugar só (#1722, critério 9).
 *
 * O Disparo pelo Canal Oficial tem motor próprio, e a unidade é o destinatário
 * (ADR-0028 §2). Antes de cada envio existem perguntas a responder POR PESSOA, e
 * elas vão crescer: hoje são regime, plano e linha; amanhã entram a Lista de
 * Supressão (#1727), o Teto de Gasto (#1725) e a saúde da conta (#1728).
 *
 * Esta é a tabela onde todas elas moram. É PURA — sem I/O, sem provedor, sem
 * relógio — para caber inteira na cabeça de quem lê e ser testada sem banco.
 * Mesmo desenho de `decisao-de-envio.ts` (#1689).
 *
 * ⚠️ FONTE ÚNICA. Se esta decisão for duplicada em outro lugar, as duas cópias
 * divergem e o comportamento passa a depender de qual caminho o envio tomou —
 * que é exatamente o defeito que o #1722 conserta na camada de cima, onde três
 * telas decidiam sozinhas quais números existiam.
 *
 * AS TRÊS AÇÕES, e a diferença está no que acontece com a LINHA:
 *
 *   enviar   manda a mensagem.
 *   pular    a LINHA não vale: grava `skipped` com o motivo e segue para a
 *            próxima. Sem telefone, já enviada, já reivindicada por outro tique.
 *   recusar  o DISPARO não pode partir: não toca na linha, não a consome, e
 *            nomeia o motivo. Plano pausado, template ausente, regime errado.
 *            A distinção é dinheiro e é retomada: uma linha `skipped` não é
 *            reprocessada, e uma linha intocada volta no próximo tique.
 */

/** O regime que a Instance impõe ao conteúdo (espelha `RegimeDeDisparo` do front). */
export type RegimeDoDisparo = "chip" | "oficial";

/**
 * O provedor da Instance decide o regime — a MESMA verdade do módulo do front
 * (`src/modules/campaigns/lib/disparo-numbers.ts`).
 *
 * ⚠️ São duas implementações da mesma regra, porque uma roda em Deno e a outra
 * no navegador, e o repo não compartilha código entre os dois lados. Um teste
 * GÊMEO (`tests/unit/regime-do-disparo-twin.test.ts`) reprova no dia em que
 * discordarem — que é exatamente o defeito que o #1722 conserta na camada de
 * cima, onde três telas decidiam sozinhas quais números existiam.
 *
 * `null` = não dispara: provedor ausente, desconhecido, ou oficial sem
 * transporte de Disparo (`meta_cloud`).
 */
export function regimeDoProvedor(provider: string | null | undefined): RegimeDoDisparo | null {
  if (provider === "uazapi" || provider === "evolution") return "chip";
  if (provider === "notificame") return "oficial";
  return null;
}

export type AcaoDoDisparo = "enviar" | "pular" | "recusar";

export interface DecisaoDoDisparo {
  acao: AcaoDoDisparo;
  /** Em português, para caber na tela sem tradução. `null` só quando envia. */
  motivo: string | null;
}

/** O Template aprovado congelado no plano. Sem variáveis nesta fatia (#1723). */
export interface TemplateDoDisparo {
  name: string;
  language: string;
  components: unknown[];
}

export interface EntradaDaDecisao {
  regime: RegimeDoDisparo;
  plano: {
    /** `blast_plans.status`: active | paused | completed | cancelled. */
    status: string;
    template: TemplateDoDisparo | null;
  };
  destinatario: {
    /** `blast_plan_recipients.status`. */
    status: string;
    phone: string | null;
    /** `claimed_at` — marca da reivindicação do worker. */
    claimedAt: string | null;
  };
}

export const MOTIVO_SEM_TELEFONE = "Destinatário sem telefone.";
export const MOTIVO_JA_PROCESSADA = "Destinatário já processado neste Disparo.";
export const MOTIVO_PLANO_PARADO = "O Disparo não está ativo.";
export const MOTIVO_SEM_TEMPLATE =
  "O Disparo pelo Canal Oficial exige um Template aprovado, e o plano não tem um.";
export const MOTIVO_SEM_REIVINDICACAO =
  "Destinatário não foi reivindicado — enviar sem reivindicação arrisca envio duplo.";
export const MOTIVO_REGIME_CHIP =
  "Este Disparo é de Chip: quem envia é o motor do fornecedor, não este worker.";

/**
 * A tabela inteira, em ordem de precedência.
 *
 * A ordem não é estética: as recusas de PLANO vêm antes das de linha, porque uma
 * linha intocada volta no próximo tique e uma linha `skipped` não volta nunca.
 * Marcar `skipped` por causa de um plano pausado queimaria o destinatário por um
 * problema que não é dele.
 */
export function decidirDisparoDoDestinatario(
  entrada: EntradaDaDecisao,
): DecisaoDoDisparo {
  // ── Recusas: o Disparo não parte, e a linha fica intacta ─────────────────
  if (entrada.regime !== "oficial")
    return { acao: "recusar", motivo: MOTIVO_REGIME_CHIP };

  if (entrada.plano.status !== "active")
    return { acao: "recusar", motivo: MOTIVO_PLANO_PARADO };

  if (!temTemplate(entrada.plano.template))
    return { acao: "recusar", motivo: MOTIVO_SEM_TEMPLATE };

  // A reivindicação é a idempotência (ADR-0028 §5). Sem chave de idempotência do
  // fornecedor, a garantia de envio único é esta marca — e uma linha que chegou
  // aqui sem ela não passou pelo claim atômico. `recusar`, não `pular`: a linha
  // é sã, quem falhou foi o caminho que a trouxe.
  if (!entrada.destinatario.claimedAt)
    return { acao: "recusar", motivo: MOTIVO_SEM_REIVINDICACAO };

  // ── Pulos: a linha não vale, e é ela que carrega o motivo ────────────────
  if (entrada.destinatario.status !== "pending")
    return { acao: "pular", motivo: MOTIVO_JA_PROCESSADA };

  if (!temTelefone(entrada.destinatario.phone))
    return { acao: "pular", motivo: MOTIVO_SEM_TELEFONE };

  return { acao: "enviar", motivo: null };
}

function temTemplate(t: TemplateDoDisparo | null): t is TemplateDoDisparo {
  return !!t && t.name.trim() !== "" && t.language.trim() !== "";
}

function temTelefone(phone: string | null): boolean {
  return (phone ?? "").trim() !== "";
}
