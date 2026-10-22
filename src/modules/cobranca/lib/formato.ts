/**
 * Dinheiro e rótulos da cobrança.
 *
 * Em cobrança o centavo importa — o valor do título e o saldo aparecem com
 * centavos. Só os agregados (métricas, soma da coluna) vão compactos.
 */
import type { CanalDeContato, Desfecho, Origem, ResultadoDoContato, TipoDeCompromisso } from "./tipos";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export function reais(valor: number): string {
  return brl.format(valor);
}

/** R$ 487,3 mil · R$ 1,2 mi · R$ 980. */
export function reaisCompacto(valor: number): string {
  const abs = Math.abs(valor);
  const fmt = (n: number, sufixo: string) =>
    `R$ ${n.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: n < 10 ? 1 : 0 })} ${sufixo}`;
  if (abs >= 1_000_000) return fmt(valor / 1_000_000, "mi");
  if (abs >= 1_000) return fmt(valor / 1_000, "mil");
  return `R$ ${Math.round(valor).toLocaleString("pt-BR")}`;
}

export const ROTULO_ORIGEM: Record<Origem, string> = {
  erp: "ERP",
  planilha: "planilha",
  manual: "manual",
};

export const ROTULO_DESFECHO: Record<Desfecho, string> = {
  recuperado: "Recuperado",
  perdido: "Perdido",
  cancelado: "Cancelado",
};

export const ROTULO_COMPROMISSO: Record<TipoDeCompromisso, string> = {
  promessa: "Promessa",
  acordo: "Acordo",
};

export const ROTULO_CANAL: Record<CanalDeContato, string> = {
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  email: "E-mail",
  presencial: "Presencial",
  outro: "Outro",
};

export const ROTULO_RESULTADO: Record<ResultadoDoContato, string> = {
  falou: "Falou com o devedor",
  nao_atendeu: "Não atendeu",
  recado: "Deixou recado",
  outro: "Outro",
};

export function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/** Primeiras letras de duas palavras com maiúscula ("Restaurante Maré Alta" → "RM"). */
export function iniciais(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter((p) => /^[\p{Lu}\d]/u.test(p));
  const base = palavras.length ? palavras : nome.trim().split(/\s+/);
  const a = base[0]?.[0] ?? "?";
  const b = base[1]?.[0] ?? base[0]?.[1] ?? "";
  return (a + b).toUpperCase();
}
