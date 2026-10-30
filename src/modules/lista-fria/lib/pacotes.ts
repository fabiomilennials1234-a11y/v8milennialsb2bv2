/**
 * Pacotes de crédito da Lista fria (ADR-0045).
 *
 * Preço de lista: crédito Google R$ 0,15 (ADR-0044) e crédito Meta R$ 0,15 (ADR-0046: o crédito Meta passou a ser
 * um seguidor varrido, não um contato, então custa o mesmo que o Google). Os pacotes de 500 ("+") e 1.000
 * ("Max") têm 5% e 10% de desconto sobre esse preço. Tudo em CENTAVOS, inteiro: dinheiro
 * em ponto flutuante dá centavo errado.
 *
 * "Google" é o nome comercial do crédito padrão (serve para Maps e CNPJ); "Meta" é o do Instagram. O banco
 * os chama `normal` e `meta` (`TipoDeCredito`).
 *
 * O preço NÃO é conferido pelo banco: não há cobrança automática. Quem libera os créditos é o master, depois
 * de ver o PIX cair, então o valor que o cliente "paga" no front só vale se o dinheiro chegou.
 */
import type { SupportPrefill } from "@/shared/errors";

import type { TipoDeCredito } from "./tipos";

export type IdDoPacote = "google" | "google_plus" | "google_max" | "meta" | "meta_plus" | "meta_max";

export interface Pacote {
  id: IdDoPacote;
  nome: string;
  tipo: TipoDeCredito;
  creditos: number;
  /** 0, 5 ou 10: desconto sobre o preço de lista do crédito. */
  descontoPct: 0 | 5 | 10;
  maisComprado: boolean;
}

/** Preço de lista de UM crédito, em centavos. */
export const PRECO_DO_CREDITO_CENTAVOS: Record<TipoDeCredito, number> = {
  normal: 15,
  meta: 15,
};

export const NOME_COMERCIAL: Record<TipoDeCredito, string> = {
  normal: "Google",
  meta: "Meta",
};

const FAMILIA = (tipo: TipoDeCredito): Pacote[] => {
  const nome = NOME_COMERCIAL[tipo];
  const id = (sufixo: "" | "_plus" | "_max") => `${tipo === "normal" ? "google" : "meta"}${sufixo}` as IdDoPacote;
  return [
    { id: id(""), nome, tipo, creditos: 100, descontoPct: 0, maisComprado: false },
    { id: id("_plus"), nome: `${nome} +`, tipo, creditos: 500, descontoPct: 5, maisComprado: true },
    { id: id("_max"), nome: `${nome} Max`, tipo, creditos: 1000, descontoPct: 10, maisComprado: false },
  ];
};

export const PACOTES_GOOGLE: readonly Pacote[] = FAMILIA("normal");
export const PACOTES_META: readonly Pacote[] = FAMILIA("meta");
export const PACOTES: readonly Pacote[] = [...PACOTES_GOOGLE, ...PACOTES_META];

/** Preço do pacote em centavos: créditos × preço de lista × (100 − desconto) / 100, sempre inteiro. */
export function precoDoPacote(p: Pick<Pacote, "tipo" | "creditos" | "descontoPct">): number {
  return Math.round((p.creditos * PRECO_DO_CREDITO_CENTAVOS[p.tipo] * (100 - p.descontoPct)) / 100);
}

/** Centavos por crédito já com o desconto (pode ter fração: 14,25 centavos). */
export const centavosPorCredito = (p: Pacote): number => precoDoPacote(p) / p.creditos;

export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "R$ 0,1425": o preço por crédito mostra até 4 casas, porque o desconto gera frações de centavo. */
export function formatarReaisPorCredito(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/** O Chamado do botão "Outro": o pedido já escrito, para o cliente só enviar. */
export const CHAMADO_OUTRO: SupportPrefill = {
  title: "Quero adquirir créditos",
  description: "Quero adquirir créditos.",
  tipo: "solicitacao",
  impacto: "incomodo",
};

/** O Chamado de quem escolheu um pacote mas não pode pagar por PIX na tela (PIX não configurado). */
export function chamadoDePedido(p: Pacote): SupportPrefill {
  return {
    title: `Quero adquirir o pacote ${p.nome} (${p.creditos.toLocaleString("pt-BR")} créditos)`,
    description: [
      "Quero adquirir créditos.",
      "",
      `Pacote: ${p.nome}`,
      `Créditos: ${p.creditos.toLocaleString("pt-BR")} ${NOME_COMERCIAL[p.tipo]}`,
      `Valor: ${formatarReais(precoDoPacote(p))}`,
    ].join("\n"),
    tipo: "solicitacao",
    impacto: "incomodo",
  };
}

/** O Chamado de "Já paguei": leva tudo que o time precisa para conferir o PIX e liberar o saldo. */
export function chamadoDePagamento(p: Pacote, referencia: string): SupportPrefill {
  return {
    title: `Paguei o pacote ${p.nome} (${p.creditos.toLocaleString("pt-BR")} créditos)`,
    description: [
      "Fiz o pagamento por PIX e quero liberar meus créditos.",
      "",
      `Pacote: ${p.nome}`,
      `Créditos: ${p.creditos.toLocaleString("pt-BR")} ${NOME_COMERCIAL[p.tipo]}`,
      `Valor pago: ${formatarReais(precoDoPacote(p))}`,
      `Referência do PIX: ${referencia}`,
      "",
      "Anexei o comprovante.",
    ].join("\n"),
    tipo: "solicitacao",
    impacto: "incomodo",
  };
}
