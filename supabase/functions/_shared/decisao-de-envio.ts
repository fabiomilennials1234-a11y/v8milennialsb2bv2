/**
 * decisao-de-envio — a regra composta do nó de texto: MANDA TEXTO, MANDA
 * TEMPLATE, ou FALHA. Num lugar só (issue #1689).
 *
 * ─── POR QUE ESTE MÓDULO EXISTE ─────────────────────────────────────────────
 *
 * Num canal oficial a Meta recusa mensagem livre depois de 24 horas sem o
 * contato falar; só template aprovado reabre a conversa. A avaliação dessa
 * janela JÁ existe e mora no send-governor, que a escopa ao provedor oficial e
 * devolve bloqueio com o motivo `outside_24h_window`. Este módulo NÃO reavalia
 * a janela — ele lê o motivo e decide o que o nó faz a seguir.
 *
 * A separação é deliberada: o governor serve outros caminhos (copiloto,
 * follow-up, disparo), e mudar o contrato dele para carregar a preferência de
 * um nó de workflow contaminaria todos eles. Quem sabe qual template usar é o
 * NÓ; quem sabe que a janela fechou é o GOVERNOR. O encontro é aqui.
 *
 * ─── POR QUE NUM LUGAR SÓ ───────────────────────────────────────────────────
 *
 * Espalhada, a regra exigiria ler o handler, o transporte e o governor para
 * prever o que acontece com uma mensagem. Aqui ela é uma tabela de três linhas,
 * pura e sem I/O — dá para lê-la inteira e dá para testá-la sem banco, sem
 * provedor e sem relógio.
 *
 * ⚠️ FALHAR NÃO É BARATO. Das 1.749 ligações entre nós dos workflows ativos,
 * ZERO são de saída de erro: um nó que falha derruba a execução inteira. Por
 * isso a falta do template não vira aviso silencioso nem pulo — vira falha com
 * MOTIVO LEGÍVEL, que é o que aparece no passo da execução e o que diz ao
 * operador o que configurar.
 */

import type { GovernorDecisionReason } from "./send-governor/types.ts";

/**
 * O motivo que o governor emite quando a janela de 24h está fechada.
 *
 * ⚠️ O TIPO É A TRAVA. Anotado como `GovernorDecisionReason` de propósito: se
 * alguém renomear a razão lá, `deno check _shared/` fica vermelho aqui em vez
 * de o escape parar de reconhecer o bloqueio em silêncio — que é exatamente a
 * falha que ninguém veria (a mensagem some, o nó falha, e o motivo muda).
 */
export const MOTIVO_JANELA_FECHADA: GovernorDecisionReason = "outside_24h_window";

/** Idioma assumido quando o nó não gravou nenhum (o mesmo do nó de template). */
export const IDIOMA_PADRAO = "pt_BR";

/**
 * O estado da janela de 24h, do ponto de vista do nó.
 *
 * Só DOIS valores, e não três: "aberta" e "não se aplica" produzem a mesma
 * decisão (manda o texto), e distingui-las aqui criaria um caso que nenhum
 * ramo usa. O chip Uazapi cai sempre em `aberta_ou_sem_janela` — não porque
 * este módulo o conheça, mas porque o governor nunca emite o motivo de janela
 * para um provedor sem janela. É essa a razão de o chip seguir idêntico.
 */
export type EstadoDaJanela = "aberta_ou_sem_janela" | "fechada";

/** O que o nó gravou no campo de escape. Tudo opcional — o vazio é o caso comum. */
export interface EscapeDeTemplate {
  name?: string | null;
  language?: string | null;
  components?: unknown[] | null;
  /** Token do template (posição ou nome) → expressão do Torque (`{{nome}}`). */
  variables?: Record<string, string> | null;
  headerMediaUrl?: string | null;
}

/** O escape depois de normalizado — o que o envio precisa, sem opcional. */
export interface EscapeResolvido {
  name: string;
  language: string;
  components: unknown[];
  variables: Record<string, string>;
  /** `null` significa "use o arquivo que veio aprovado com o template". */
  headerMediaUrl: string | null;
}

export type DecisaoDeEnvio =
  /** A janela não é o problema: o texto é o caminho. */
  | { acao: "texto" }
  /** A janela fechou e o nó declarou por onde escapar. */
  | { acao: "template"; escape: EscapeResolvido }
  /** A janela fechou e não há por onde escapar. `motivo` vai para o passo. */
  | { acao: "falhar"; motivo: string };

/**
 * O bloqueio de janela, como o transporte o devolve.
 *
 * `whatsapp-dispatch` serializa um bloqueio do governor em
 * `governor_<ação>:<motivo>`, e os dois caminhos de envio do nó de texto (o
 * gateway unificado e o legado) propagam essa string. O casamento é ANCORADO
 * nesse formato de propósito: procurar só `outside_24h_window` solto acharia a
 * palavra dentro de qualquer texto de erro — inclusive num erro do fornecedor
 * que a cite —, e o nó escaparia para template por causa de uma coincidência.
 */
const BLOQUEIO_DE_JANELA = new RegExp(
  `governor_[a-z]+:${MOTIVO_JANELA_FECHADA}`,
);

/**
 * Traduz a falha do transporte no estado da janela.
 *
 * Só o bloqueio EXPLÍCITO do governor conta como janela fechada. Qualquer outra
 * falha — número inválido, sessão morta, 500 do fornecedor, template removido —
 * devolve `aberta_ou_sem_janela`, e o nó falha com o erro original em vez de
 * gastar um template para responder a um problema que não é de janela.
 */
export function janelaPeloErroDoTransporte(
  erro: string | null | undefined,
): EstadoDaJanela {
  if (!erro) return "aberta_ou_sem_janela";
  return BLOQUEIO_DE_JANELA.test(erro) ? "fechada" : "aberta_ou_sem_janela";
}

/**
 * O nó tem escape utilizável? O NOME é o que decide.
 *
 * Sem nome não há o que a Meta referencie — idioma, componentes e variáveis
 * sozinhos não endereçam template nenhum. Espaço em branco é tratado como
 * ausência: um campo tocado e apagado não pode valer como configuração.
 */
export function escapeConfigurado(
  escape: EscapeDeTemplate | null | undefined,
): EscapeResolvido | null {
  const nome = typeof escape?.name === "string" ? escape.name.trim() : "";
  if (!nome) return null;

  const idioma = typeof escape?.language === "string" ? escape.language.trim() : "";
  const midia = typeof escape?.headerMediaUrl === "string"
    ? escape.headerMediaUrl.trim()
    : "";

  return {
    name: nome,
    language: idioma || IDIOMA_PADRAO,
    components: Array.isArray(escape?.components) ? escape.components : [],
    variables: escape?.variables ?? {},
    headerMediaUrl: midia || null,
  };
}

/**
 * A mensagem que o operador lê no passo da execução quando a janela fechou e o
 * nó não tem escape.
 *
 * Escrita para quem configura o funil, não para quem depura o código: diz o que
 * aconteceu, por que a mensagem não saiu e qual é a ação. O prefixo é estável
 * de propósito — é por ele que se distingue esta falha das outras na lista de
 * execuções, onde o passo mostra a string crua.
 */
export const MOTIVO_LEGIVEL_SEM_ESCAPE =
  "Janela de 24h fechada: o lead não fala com este número há mais de 24 horas, " +
  "e a Meta só aceita template aprovado nessa situação. Configure um template " +
  "de escape neste nó para reabrir a conversa.";

/**
 * A regra composta. Dado o estado da janela e o escape declarado no nó, o que
 * o nó de texto faz.
 *
 *   janela aberta / sem janela  → texto      (o chip Uazapi está sempre aqui)
 *   janela fechada + escape     → template
 *   janela fechada sem escape   → falha, com motivo legível
 *
 * Pura: sem I/O, sem relógio, sem provedor. É a ÚNICA fonte dessa decisão — o
 * handler é adaptador dela, não um segundo lugar onde ela é tomada.
 */
export function decidirEnvioDoNoDeTexto(entrada: {
  janela: EstadoDaJanela;
  escape?: EscapeDeTemplate | null;
}): DecisaoDeEnvio {
  if (entrada.janela !== "fechada") return { acao: "texto" };

  const escape = escapeConfigurado(entrada.escape);
  if (!escape) return { acao: "falhar", motivo: MOTIVO_LEGIVEL_SEM_ESCAPE };

  return { acao: "template", escape };
}

/**
 * Lê o escape a partir do `params` do nó, sem que o handler precise conhecer os
 * nomes dos campos. Os cinco vivem juntos porque são um objeto só quebrado em
 * colunas — separá-los no leitor faria o handler repetir a lista.
 */
export function escapeDoNo(
  params: Record<string, unknown>,
): EscapeDeTemplate {
  return {
    name: params.escapeTemplateName as string | undefined,
    language: params.escapeTemplateLanguage as string | undefined,
    components: params.escapeTemplateComponents as unknown[] | undefined,
    variables: params.escapeTemplateVariables as Record<string, string> | undefined,
    headerMediaUrl: params.escapeTemplateHeaderMediaUrl as string | undefined,
  };
}
