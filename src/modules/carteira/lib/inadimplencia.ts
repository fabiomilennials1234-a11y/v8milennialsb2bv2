import type { Titulo } from "@/modules/integrations";

/**
 * Inadimplência — Carteira health projection over a client's Títulos (módulo G,
 * S9, ADR-0020). Pure: given the client's receivables, derive whether it is
 * delinquent and how much revenue is at risk (sum of overdue títulos).
 *
 * Carteira READS titulos_receber for display; the integrations BC WRITES them
 * via the Omie sync — no cross-module dependency needed here.
 */

export interface InadimplenciaTitulo {
  status: string; // "aberto" | "pago" | "atrasado"
  valor: number | null;
  /** ISO `aaaa-mm-dd`. Sem ele, só o `status` decide. */
  vencimento?: string | null;
}

export interface Inadimplencia {
  /** True when the client holds one or more overdue títulos. */
  isInadimplente: boolean;
  overdueCount: number;
  /** Aggregate overdue amount — the client's receita-em-risco. */
  receitaEmRisco: number;
}

// ───────────────────────────────────────────────────────────────────────────
// A régua do atraso — UMA, para o selo e para o card
// ───────────────────────────────────────────────────────────────────────────
//
// `status` é o que o ERP disse na última sincronização, e entre uma e outra o
// calendário anda — um título "aberto" com vencimento ontem JÁ está atrasado.
// Por isso a DATA é a régua e o status entra como PISO, nunca como teto: se o
// ERP já disse `atrasado`, respeitamos mesmo sem data. `pago` nunca conta.
//
// 🔴 Chamado 065e4890: o selo usava só o status e o card usava a data. Na mesma
// tela, "Inadimplente · R$ 2.220" no selo e "Atrasado R$ 2.960" no card — o
// título aberto que venceu 14/09 entrava num e não no outro. Uma tela, um
// número: as duas funções abaixo passam por `estaAtrasado`.
//
// Título SEM vencimento existe (o ERP aceita) e não vira "atrasado" por
// omissão: conta no valor em aberto e fica fora da fila de atraso, com rótulo
// próprio. Dizer "vence hoje" sobre um campo vazio seria inventar data.

const DIA = 24 * 60 * 60 * 1000;

/** Dias inteiros entre a data e hoje, no fuso local do navegador. */
function diasDesde(vencimento: string, hoje: Date): number {
  const [ano, mes, dia] = vencimento.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return 0;
  const alvo = new Date(ano, mes - 1, dia);
  const zero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((zero.getTime() - alvo.getTime()) / DIA);
}

function estaAtrasado(status: string, diasDeAtraso: number | null): boolean {
  if (status === "pago") return false;
  return status === "atrasado" || (diasDeAtraso !== null && diasDeAtraso > 0);
}

export function computeInadimplencia(
  titulos: InadimplenciaTitulo[],
  hoje: Date = new Date(),
): Inadimplencia {
  const atrasados = titulos.filter((t) =>
    estaAtrasado(t.status, t.vencimento ? diasDesde(t.vencimento, hoje) : null),
  );
  const receitaEmRisco = atrasados.reduce((sum, t) => sum + (Number(t.valor) || 0), 0);
  return {
    isInadimplente: atrasados.length > 0,
    overdueCount: atrasados.length,
    receitaEmRisco,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// SCRUM-229 bloco 4.1 — a leitura POR TÍTULO, para a tela do cliente
// ───────────────────────────────────────────────────────────────────────────
//
// `computeInadimplencia` acima responde uma pergunta agregada — "este cliente
// está inadimplente e quanto está em risco?" — e é a fonte do badge e do KPI.
// O que faltava para a tela é a FILA: qual título, vencendo quando, com quantos
// dias de atraso. Mesma régua, mais detalhe.

export interface TituloNaTela extends Titulo {
  /** Dias de atraso; 0 quando vence hoje, negativo quando ainda vai vencer. */
  diasDeAtraso: number | null;
  atrasado: boolean;
}

export interface ResumoDeInadimplencia {
  /** Soma dos títulos NÃO pagos (aberto + atrasado). */
  emAberto: number;
  /** Soma só dos atrasados pela régua da data. */
  atrasado: number;
  /** Quantos títulos estão atrasados. */
  quantidadeAtrasada: number;
  /** Vencimento mais próximo entre os não pagos e ainda não vencidos. */
  proximoVencimento: string | null;
  /** Maior atraso em dias, entre os atrasados. */
  maiorAtraso: number | null;
  /** Não pagos, ordenados: atrasados primeiro (mais antigo no topo). */
  fila: TituloNaTela[];
}

export function resumirInadimplencia(
  titulos: Titulo[],
  hoje: Date = new Date(),
): ResumoDeInadimplencia {
  const naoPagos = titulos.filter((t) => t.status !== "pago");

  const naTela: TituloNaTela[] = naoPagos.map((t) => {
    const dias = t.vencimento ? diasDesde(t.vencimento, hoje) : null;
    return {
      ...t,
      diasDeAtraso: dias,
      atrasado: estaAtrasado(t.status, dias),
    };
  });

  const atrasados = naTela.filter((t) => t.atrasado);

  const aVencer = naTela
    .filter((t) => !t.atrasado && t.vencimento)
    .map((t) => t.vencimento as string)
    .sort();

  const soma = (lista: TituloNaTela[]) =>
    lista.reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  return {
    emAberto: soma(naTela),
    atrasado: soma(atrasados),
    quantidadeAtrasada: atrasados.length,
    proximoVencimento: aVencer[0] ?? null,
    maiorAtraso: atrasados.length
      ? Math.max(...atrasados.map((t) => t.diasDeAtraso ?? 0))
      : null,
    // Atrasados primeiro, do mais antigo para o mais novo; depois os a vencer,
    // do mais próximo para o mais distante. É a ordem da cobrança.
    fila: [...naTela].sort((a, b) => {
      if (a.atrasado !== b.atrasado) return a.atrasado ? -1 : 1;
      const va = a.vencimento ?? "9999-12-31";
      const vb = b.vencimento ?? "9999-12-31";
      return va.localeCompare(vb);
    }),
  };
}
