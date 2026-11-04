/**
 * Regras puras do "Importar e Disparar" da Lista fria (ADR-0048).
 *
 * Sem I/O: a edge function lista-fria-importar-e-disparar chama estas funções
 * antes de escrever qualquer coisa, e os testes cobrem cada uma isolada.
 */
import { DEFAULT_BLAST_WINDOW } from "./quick-blast/blast-plan-distribution.ts";
import { nextValidSendTime, type QuietWindow } from "./quick-blast/quiet-hours.ts";

/**
 * Variáveis que o disparo em plano congela por lead (`snapshotVars` em
 * quick-blast/blast-plan.ts). Qualquer outra sai VAZIA na mensagem do lead —
 * por isso a função recusa em vez de deixar passar.
 */
export const VARIAVEIS_DO_DISPARO = ["nome", "primeiro_nome", "empresa", "segmento"] as const;

// Mesmo formato de token que resolveBlastMessage aceita: {{chave}} ou {chave}.
// Spintax {a|b} tem `|` e não casa com nenhuma das duas alternativas.
const TOKEN_DE_VARIAVEL = /\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g;

/** Variáveis usadas na mensagem que o disparo não sabe preencher (sem repetição, na ordem em que aparecem). */
export function variaveisDesconhecidas(mensagem: string): string[] {
  const conhecidas = new Set<string>(VARIAVEIS_DO_DISPARO);
  const achadas: string[] = [];
  for (const m of mensagem.matchAll(TOKEN_DE_VARIAVEL)) {
    const chave = m[1] ?? m[2];
    if (!conhecidas.has(chave) && !achadas.includes(chave)) achadas.push(chave);
  }
  return achadas;
}

/** Janela do disparo frio: a padrão do motor (seg a sáb, 08h às 20h), em horário de Brasília. */
export const JANELA_DO_DISPARO_FRIO: QuietWindow = DEFAULT_BLAST_WINDOW;

/** "YYYY-MM-DDTHH:mm" no relógio de Brasília para o instante dado. */
export function relogioDeBrasilia(agora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(agora);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)!.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}

/**
 * O primeiro lote do motor de disparo sai na hora da criação, sem olhar o
 * relógio (a janela só adia os lotes seguintes). Para o disparo frio isso é
 * perigoso — mensagem às 23h é o caminho mais curto para banir o chip — então
 * a função recusa fora da janela, antes de importar qualquer coisa.
 */
export function dentroDaJanela(agora: Date, janela: QuietWindow = JANELA_DO_DISPARO_FRIO): boolean {
  const local = relogioDeBrasilia(agora);
  return nextValidSendTime(janela, local) === local;
}

/** Texto para o usuário quando o disparo cai fora da janela. */
export function textoDaJanela(janela: QuietWindow = JANELA_DO_DISPARO_FRIO): string {
  const hh = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}h`;
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const lista = janela.days.map((d) => dias[d]).join(", ");
  return `${lista}, das ${hh(janela.fromMinutes)} às ${hh(janela.toMinutes)} (Brasília)`;
}
