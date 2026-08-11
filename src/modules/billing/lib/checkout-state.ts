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
