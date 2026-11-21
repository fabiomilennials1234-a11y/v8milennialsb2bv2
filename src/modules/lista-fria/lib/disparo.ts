/**
 * Regras do "Importar e Disparar" que a tela precisa conhecer (ADR-0048).
 *
 * O servidor é a garantia (lista-fria-importar-e-disparar e a RPC
 * lista_fria_disparo_preparar repetem cada checagem); aqui só se adianta o erro
 * para o usuário não preencher um formulário que vai ser recusado.
 */

/** Variáveis que o disparo em plano preenche por lead. Qualquer outra sairia vazia. */
export const VARIAVEIS_DO_DISPARO = [
  { chave: "primeiro_nome", rotulo: "Primeiro nome" },
  { chave: "nome", rotulo: "Nome" },
  { chave: "empresa", rotulo: "Empresa" },
  { chave: "segmento", rotulo: "Segmento" },
] as const;

// Mesmo token que o servidor aceita: {{chave}} ou {chave}. Spintax {a|b} não casa.
const TOKEN_DE_VARIAVEL = /\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g;

export function variaveisDesconhecidas(mensagem: string): string[] {
  const conhecidas = new Set<string>(VARIAVEIS_DO_DISPARO.map((v) => v.chave));
  const achadas: string[] = [];
  for (const m of mensagem.matchAll(TOKEN_DE_VARIAVEL)) {
    const chave = m[1] ?? m[2];
    if (!conhecidas.has(chave) && !achadas.includes(chave)) achadas.push(chave);
  }
  return achadas;
}

export const LIMITE_DA_MENSAGEM = 4000;
/** Teto de contatos por pedido (o mesmo de lista_fria_disparo_preparar). */
export const TETO_DO_DISPARO = 500;

export interface CadenciaDoDisparo {
  id: "cautelosa" | "padrao" | "rapida";
  rotulo: string;
  descricao: string;
  minMs: number;
  maxMs: number;
}

/** O servidor impõe piso de 3 s; "rápida" é o mais perto disso que a tela oferece. */
export const CADENCIAS: readonly CadenciaDoDisparo[] = [
  { id: "cautelosa", rotulo: "Cautelosa", descricao: "10 a 40 s entre mensagens", minMs: 10_000, maxMs: 40_000 },
  { id: "padrao", rotulo: "Padrão", descricao: "5 a 30 s entre mensagens", minMs: 5_000, maxMs: 30_000 },
  { id: "rapida", rotulo: "Rápida", descricao: "3 a 10 s entre mensagens", minMs: 3_000, maxMs: 10_000 },
];

export const CADENCIA_PADRAO: CadenciaDoDisparo["id"] = "padrao";

/** Janela do disparo frio: seg a sáb, 08h às 20h, horário de Brasília (a do motor de disparo). */
export const JANELA_FRIA = { dias: [1, 2, 3, 4, 5, 6], deMin: 8 * 60, ateMin: 20 * 60 } as const;
export const TEXTO_DA_JANELA = "seg a sáb, das 08h às 20h (Brasília)";

/** Dia da semana (0=dom) e minutos desde a meia-noite, no relógio de Brasília. */
function relogioDeBrasilia(agora: Date): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(agora);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)!.value;
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { dia: dias.indexOf(p("weekday")), minutos: Number(p("hour")) * 60 + Number(p("minute")) };
}

export function dentroDaJanelaFria(agora: Date = new Date()): boolean {
  const { dia, minutos } = relogioDeBrasilia(agora);
  return (JANELA_FRIA.dias as readonly number[]).includes(dia) && minutos >= JANELA_FRIA.deMin && minutos < JANELA_FRIA.ateMin;
}

/** Só chip WhatsApp não oficial e sem reserva de setor pode fazer prospecção. */
export function chipPodeDispararFrio(i: { provider: string; reserved_for: string | null }): boolean {
  return (i.provider === "uazapi" || i.provider === "evolution") && i.reserved_for === null;
}

/**
 * O que o diálogo promete. `aguardando` são contatos que um disparo anterior
 * importou e deixou sem mensagem: já são leads e já têm negócio, falta o envio.
 */
export function resumoDoDisparo(selecionados: number, aguardando: number): { total: number; retomada: boolean } {
  return { total: selecionados + aguardando, retomada: aguardando > 0 && selecionados === 0 };
}

export interface PedidoDeDisparo {
  funilId: string;
  etapaId: string;
  mensagem: string;
  chipIds: string[];
  cadencia: CadenciaDoDisparo["id"];
}

/** O que falta preencher, na ordem em que a tela mostra. Vazio = pode confirmar. */
export function pendenciasDoPedido(p: PedidoDeDisparo): string[] {
  const falta: string[] = [];
  if (!p.funilId) falta.push("Escolha o funil.");
  else if (!p.etapaId) falta.push("Escolha a etapa.");
  if (p.mensagem.trim().length === 0) falta.push("Escreva a mensagem.");
  else if (p.mensagem.length > LIMITE_DA_MENSAGEM) falta.push(`A mensagem passou de ${LIMITE_DA_MENSAGEM} caracteres.`);
  const desconhecidas = variaveisDesconhecidas(p.mensagem);
  if (desconhecidas.length > 0) {
    falta.push(`${desconhecidas.map((v) => `{{${v}}}`).join(", ")} não existe no disparo e sairia vazio.`);
  }
  if (p.chipIds.length === 0) falta.push("Escolha de qual número a mensagem sai.");
  return falta;
}
