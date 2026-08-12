/**
 * Resolvedor de estado da página pública de checkout (SCRUM-289, Fatia 8).
 *
 * A página tem 11 estados no protótipo aprovado, mas ela NÃO decide sozinha em
 * qual está: quem decide é o servidor. Este módulo é a única tradução entre a
 * resposta da porta pública (`billing-payment-link`) e o estado que a tela
 * renderiza — e existe separado da tela justamente para ser testável sem DOM.
 *
 * DUAS REGRAS DE CONTRATO, acertadas com a porta pública antes de qualquer um
 * dos dois construir:
 *
 *  1. `state` é enum FECHADO e a cópia é NOSSA. A porta manda o estado, não a
 *     frase: microcopy em dois lugares vira drift na primeira vez que alguém
 *     mexe no tom, e a tela precisa de LAYOUT por estado (ícone, ação
 *     secundária, se tem botão de voltar), não de string.
 *
 *  2. Estado desconhecido NÃO quebra a tela. A porta pode ADICIONAR estado sem
 *     nos avisar — foi o que combinamos em troca de não recebermos copy — então
 *     qualquer valor fora do conjunto conhecido cai num fallback genérico. Uma
 *     página de pagamento que renderiza tela branca porque o backend evoluiu é
 *     pior que uma que diz "não foi possível carregar".
 *
 * O QUE ESTE MÓDULO DELIBERADAMENTE NÃO SABE: a diferença entre `confirmed` e
 * `received` da Asaas. Essa distinção é FINANCEIRA (dinheiro confirmado versus
 * dinheiro disponível, que no cartão são 32 dias de diferença), não de produto.
 * A porta entrega `paid` e pronto. Se ela vazasse o vocabulário do gateway, o
 * dia em que a regra de liberação mudasse a tela teria que mudar junto.
 */

/** Estados que a porta pública devolve ao resolver o token. */
export type LinkState = "valid" | "expired" | "already_paid" | "revoked" | "not_found";

/** Estado do pagamento, depois que a página já resolveu um link válido. */
export type PaymentState = "pending" | "paid" | "failed";

/**
 * Estado de tela. Nomes iguais aos `data-state` do protótipo aprovado, para que
 * a conversa entre design e código não precise de dicionário.
 */
export type CheckoutScreen =
  | "carregando"
  | "pedido"
  | "expirado"
  | "usado"
  | "revogado"
  | "nao_encontrado"
  | "indisponivel";

/** Recorte da resposta da porta que este resolvedor consome. */
export interface PaymentLinkResponse {
  state: string;
  link?: unknown;
}

/**
 * Traduz a resposta da porta em estado de tela.
 *
 * `valid` sem objeto `link` cai em `indisponivel` de propósito: um link válido
 * sem os dados do pedido não tem o que renderizar, e mostrar a moldura vazia do
 * checkout é pior que assumir a falha — o cliente ficaria olhando um preço que
 * não existe.
 */
export function resolveScreen(response: PaymentLinkResponse | null | undefined): CheckoutScreen {
  if (!response || typeof response.state !== "string") return "indisponivel";

  switch (response.state) {
    case "valid":
      return response.link ? "pedido" : "indisponivel";
    case "expired":
      return "expirado";
    case "already_paid":
      return "usado";
    case "revoked":
      return "revogado";
    case "not_found":
      return "nao_encontrado";
    default:
      // Estado novo que a porta passou a devolver. Ver regra 2 no cabeçalho.
      return "indisponivel";
  }
}

/**
 * Um estado de tela é TERMINAL quando não existe ação de pagamento possível
 * nele. A página usa isto para não montar o polling de status: pedir status de
 * um link expirado é gastar requisição do teto que a porta impõe por IP, sem
 * chance nenhuma de a resposta mudar.
 */
export function isTerminal(screen: CheckoutScreen): boolean {
  return (
    screen === "expirado" ||
    screen === "usado" ||
    screen === "revogado" ||
    screen === "nao_encontrado"
  );
}

/* ==========================================================================
 * OS ESTADOS DE PAGAMENTO
 *
 * Tudo acima resolve a PROPOSTA: existe, venceu, foi revogada. Daqui para
 * baixo é o que acontece DEPOIS de o cliente escolher como pagar.
 *
 * POR QUE ISTO É UMA FUNÇÃO PURA E NÃO ESTADO ESPALHADO NO COMPONENTE
 * ------------------------------------------------------------------
 * São nove entradas possíveis combinando método, status do pagamento, alvo da
 * proposta e retorno do componente hospedado. Espalhadas em `useState` dentro
 * da página, a combinação errada não aparece em teste nenhum — aparece no
 * cliente, e neste fluxo "aparecer no cliente" significa alguém que pagou
 * olhando uma tela que diz que não pagou.
 *
 * `mensal` NÃO É UM ESTADO DE TELA, e isso diverge da lista do handoff §4 de
 * propósito. O protótipo aprovado (LAUDO §3, "Pix indisponível no mensal") não
 * desenha uma tela: desenha o card do Pix ESMAECIDO dentro da tela do pedido,
 * com o motivo dentro dele e a saída logo abaixo do grupo. Modelar como tela
 * própria obrigaria a página a trocar de layout por causa de um card
 * desabilitado — e o cliente perderia de vista o pedido que está comprando.
 * Aqui ele é `pixBloqueado`, um modificador de `pedido`.
 * ========================================================================== */

/** Método escolhido pelo cliente. `null` = ainda não escolheu. */
export type MetodoEscolhido = "pix" | "credit_card" | null;

/** O que o endpoint de status devolve. Enum fechado, vocabulário de PRODUTO. */
export type StatusPagamento = "pending" | "paid" | "expired" | "failed";

export type TelaDePagamento =
  | "pix"
  | "cartao_antes"
  | "cartao_analise"
  | "cartao_incompleto"
  | "aprovado_nova"
  | "aprovado_existente"
  | "recusado";

export interface EntradaDePagamento {
  /** Alvo da proposta — decide QUAL tela de aprovado. */
  targetKind?: "new_org" | "existing_org" | string | null;
  metodo: MetodoEscolhido;
  status: StatusPagamento;
  /**
   * O cliente já foi para o componente hospedado do Asaas e VOLTOU sem que a
   * cobrança tenha desfecho.
   *
   * É o estado 06 do protótipo, e o LAUDO diz que é "o que ninguém desenha":
   * apertou voltar, fechou o componente ou desistiu no meio. Acontece o tempo
   * todo e NÃO É ERRO — o passo 1 da trilha leva um traço neutro, nunca um X
   * vermelho. Sem ele, o retorno interrompido cai numa tela genérica e a venda
   * morre em silêncio.
   */
  voltouSemConcluir?: boolean;
  /**
   * A cobrança chegou a existir no gateway para este método.
   *
   * É o que separa os dois retornos, e sem ele o estado 05 do protótipo seria
   * INALCANÇÁVEL — foi o que aconteceu na primeira versão desta função, e o
   * teste não teria pego, porque um estado que nunca é produzido também nunca
   * é asserido.
   *
   * O status do servidor não serve para separar: `in_analysis` da Asaas é
   * mapeado para `pending` de propósito, porque o vocabulário do gateway não
   * vaza para a tela. Então a distinção mora aqui, onde a página SABE se
   * chegou a criar cobrança:
   *
   *   voltou + cobrança existe   → 05 análise      (há dinheiro em processo)
   *   voltou + cobrança não      → 06 incompleto   (não há nada em processo)
   */
  cobrancaCriada?: boolean;
}

/**
 * Traduz método + status + alvo na tela de pagamento. `null` = a página
 * continua na tela do pedido, porque nada de pagamento começou.
 *
 * PRECEDÊNCIA, e ela é a mesma do servidor pelo mesmo motivo: o desfecho do
 * DINHEIRO vence a navegação. Um cliente que voltou do componente hospedado
 * "sem concluir" e cujo pagamento CAIU no meio tempo tem que ver aprovado, não
 * a trilha interrompida — senão a tela contradiz o extrato dele.
 */
export function resolvePaymentScreen(entrada: EntradaDePagamento): TelaDePagamento | null {
  const { targetKind, metodo, status, voltouSemConcluir, cobrancaCriada } = entrada;

  if (status === "paid") {
    // O alvo decide a mensagem inteira, não um parágrafo: `new_org` abre com o
    // que acontece agora (empresa criada, acesso a caminho), e `existing_org`
    // abre com a frase que impede o pânico — leads, conversas e histórico
    // continuam como estavam. Alvo desconhecido cai no caminho conservador, que
    // é o que NÃO promete criação de empresa.
    return targetKind === "new_org" ? "aprovado_nova" : "aprovado_existente";
  }

  if (status === "failed") return "recusado";

  // `expired` não tem tela de pagamento: quem manda é a proposta, e a página
  // já está em `expirado` pelo resolvedor de cima. Devolver tela aqui criaria
  // dois donos para a mesma decisão.
  if (status === "expired") return null;

  // Daqui para baixo, status === "pending".
  if (metodo === "pix") return "pix";

  if (metodo === "credit_card") {
    if (!voltouSemConcluir) return "cartao_antes";
    return cobrancaCriada ? "cartao_analise" : "cartao_incompleto";
  }

  return null;
}

/**
 * O Pix é vendido a partir do semestral. A regra é do motor de preço
 * (`_shared/payments/policy.ts` + o CHECK `org_subscriptions_pix_long_cycle_only`),
 * e esta função é LEITURA dela para desabilitar o card — não é uma segunda
 * cópia com autoridade própria. Se a regra comercial mudar, muda lá; aqui o
 * ciclo desconhecido é tratado como BLOQUEADO, que é a direção segura: oferecer
 * um método que o servidor vai recusar é pior que esconder um que ele aceitaria.
 */
export function pixBloqueado(billingCycle: string | null | undefined): boolean {
  return billingCycle !== "semiannual" && billingCycle !== "annual";
}

/**
 * A trilha de continuidade do cartão — três passos, SEMPRE os mesmos, em quatro
 * momentos. É a peça que faz o retorno do componente hospedado não parecer
 * falha: o cliente vê a trilha inteira antes de sair e, quando volta, encontra
 * a MESMA trilha adiantada, não uma tela nova para interpretar como erro.
 *
 * `neutro` existe e não é `pendente`: no retorno interrompido o passo 1 leva um
 * traço, não um X. Um X ali diz ao cliente que ele errou, e ele não errou.
 */
export type PassoDaTrilha = "pendente" | "feito" | "andamento" | "neutro";

export function trilhaDoCartao(tela: TelaDePagamento | null): PassoDaTrilha[] {
  switch (tela) {
    case "cartao_antes":
      return ["pendente", "pendente", "pendente"];
    case "cartao_analise":
      return ["feito", "feito", "andamento"];
    case "cartao_incompleto":
      return ["neutro", "feito", "pendente"];
    case "aprovado_nova":
    case "aprovado_existente":
      return ["feito", "feito", "feito"];
    default:
      return [];
  }
}
