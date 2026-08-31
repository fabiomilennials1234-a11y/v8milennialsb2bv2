/**
 * Memória de conversa do Oráculo.
 *
 * O produto atual manda `[system, user]` a cada pergunta — sem histórico. É a
 * razão número um de ele não parecer inteligente: quem faz a segunda pergunta
 * descobre que ele esqueceu a primeira.
 *
 * A memória tem duas camadas: os últimos turnos na íntegra, e um resumo
 * acumulado do que saiu da janela.
 */

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface BuildTurnContextArgs {
  /** Do mais antigo ao mais recente. */
  history: Turn[];
  /** Resumo acumulado dos turnos que já saíram da janela. */
  summary: string | null;
  /** Quantos turnos ficam na íntegra. */
  keepLastTurns: number;
}

export interface TurnContext {
  /** O que vai ao modelo, na ordem. */
  messages: Turn[];
  /** Turnos que saíram da janela e precisam ser absorvidos pelo resumo. */
  evicted: Turn[];
  /** Resumo acumulado, injetado no system prompt — nunca fingido de turno. */
  summary: string | null;
}

export function buildTurnContext(args: BuildTurnContextArgs): TurnContext {
  const cut = Math.max(0, args.history.length - args.keepLastTurns);

  return {
    messages: args.history.slice(cut),
    evicted: args.history.slice(0, cut),
    summary: args.summary,
  };
}
