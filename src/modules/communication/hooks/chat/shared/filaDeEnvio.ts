/**
 * Fila de envio por conversa do WhatsApp — a garantia de ordem e de "nunca dois
 * em voo", num lugar só.
 *
 * ─── POR QUE EXISTE ─────────────────────────────────────────────────────────
 *
 * Até 19/11 o composer travava o segundo envio com "Aguarde o envio anterior
 * finalizar": o vendedor digitava, apertava Enter e era barrado. A trava era a
 * única coisa que garantia a ordem no WhatsApp e impedia dois POSTs paralelos
 * para o mesmo número (vetor de ban). A fila troca a trava por espera: o
 * segundo envio vira bolha na hora e SAI depois do primeiro, nunca junto.
 *
 * ─── AS GARANTIAS, E QUEM DÁ CADA UMA ───────────────────────────────────────
 *
 * 1. Ordem e um em voo — `scope` do TanStack v5. Mutações com o mesmo
 *    `scope.id` rodam em série, na ordem em que foram criadas
 *    (`mutationCache.canRun/runNext`). Texto e mídia usam o MESMO id, então
 *    intercalar os dois não inverte nada.
 *
 *    O escopo é POR CHAMADA, e não por hook: a conversa está nas variáveis, e
 *    `useMutation` lê `scope` das opções do observer. Trocar a opção com a
 *    mutação pendente reescreve o `scope` dela no meio do caminho (o observer
 *    repassa as opções novas à mutação em voo), e ela sairia da fila errada.
 *    Por isso cada envio nasce do seu próprio `MutationObserver`, com o escopo
 *    da SUA conversa, e o solta ao terminar.
 *
 * 2. Bolha instantânea — `onMutate` roda ANTES do `retryer.start()`
 *    (query-core 5.83.0 `mutation.js:82-92`), inclusive para a mutação que fica
 *    pausada esperando a vez. A bolha aparece na hora; o POST espera.
 *
 * 3. Parar na falha — item N falha → a fila é marcada interrompida; os
 *    seguintes lançam `FilaInterrompidaError` dentro do `mutationFn`, ANTES de
 *    qualquer chamada de edge function, e viram bolha de falha com reenvio
 *    manual. A ordem nunca inverte: nada sai depois de um buraco.
 *
 * 4. Teto — 5 itens por conversa. O sexto nem entra (`FilaCheiaError`, sem
 *    bolha); o composer avisa "fila cheia" e devolve o rascunho.
 *
 * 5. Confirm sem falso positivo — a confirmação de envio ambíguo
 *    (timeout/5xx) procura a linha gravada pelo webhook por CONTEÚDO. Marcar
 *    "enviada" uma mensagem que não saiu é perda silenciosa; o contrário (bolha
 *    de falha com reenvio manual) é aceitável. Por isso o confirm CONTA: ver
 *    `provaDeConfirmacao`.
 *
 * 6. Sair com fila — `beforeunload` avisa enquanto houver item em qualquer
 *    fila. Registrado aqui, e não num hook de tela, para cobrir todo composer
 *    (chat, bolha, celular) sem cada um lembrar.
 *
 * Retentativa continua sendo só do `sendWithBoundedRecovery` (`retry: false`
 * na mutação). A fila não reenvia nada.
 */
import { MutationObserver, type MutationObserverOptions, type QueryClient } from "@tanstack/react-query";
import { resolveWhatsAppDestination } from "@/modules/communication/lib/whatsappPhone";

/** Itens (em voo + esperando) que uma conversa aceita de uma vez. */
export const LIMITE_DA_FILA_POR_CONVERSA = 5;

/** Raiz da `mutationKey` de todo envio de WhatsApp pelo CRM. */
export const RAIZ_DA_FILA = "whatsapp_send" as const;

/** Texto de produto do aviso de fila cheia (o composer mostra este, não `err.message`). */
export const MENSAGEM_DE_FILA_CHEIA =
  `Fila cheia: ${LIMITE_DA_FILA_POR_CONVERSA} mensagens desta conversa ainda estão saindo. Aguarde uma delas sair.`;

/** O sexto envio de uma conversa. Lançado ANTES de existir bolha ou mutação. */
export class FilaCheiaError extends Error {
  constructor() {
    super(MENSAGEM_DE_FILA_CHEIA);
    this.name = "FilaCheiaError";
  }
}

/** Item que estava esperando a vez quando um anterior falhou. Nunca chamou o provider. */
export class FilaInterrompidaError extends Error {
  constructor() {
    super("Não enviada: a anterior falhou. Reenvie quando quiser.");
    this.name = "FilaInterrompidaError";
  }
}

/** A conversa de um envio: org + caixa + destino. */
export interface ConversaDaFila {
  organizationId: string | null | undefined;
  instanceId: string | null | undefined;
  phoneNumber: string;
  isGroup?: boolean;
}

/**
 * O destino como o provider o vê. Dois formatos do mesmo número (com e sem
 * nono dígito, com e sem DDI) são a mesma conversa no WhatsApp — e dois
 * composers (o /chat e a bolha) podem chegar com formatos diferentes. Sem
 * normalizar, a mesma conversa teria duas filas e dois envios em voo.
 */
function destinoDaFila(c: ConversaDaFila): string {
  return resolveWhatsAppDestination(c.phoneNumber, c.isGroup)?.number ?? c.phoneNumber;
}

export function chaveDaFila(c: ConversaDaFila) {
  return [RAIZ_DA_FILA, c.organizationId ?? null, c.instanceId ?? null, destinoDaFila(c)] as const;
}

export function escopoDaFila(c: ConversaDaFila): string {
  return `wa-send:${c.organizationId ?? ""}:${c.instanceId ?? "sem-caixa"}:${destinoDaFila(c)}`;
}

// ─── Estado por fila ──────────────────────────────────────────────────────────

/**
 * Como o confirm reconhece "esta mensagem": os mesmos filtros da consulta
 * (citação + mídia OU texto). Duas mensagens com a mesma assinatura são
 * indistinguíveis no banco sem o id do provider.
 */
export function assinaturaDoEnvio(o: { conteudo: string | null; mediaUrl?: string | null; citacao?: string | null }): string {
  return JSON.stringify([o.citacao ?? null, o.mediaUrl ? "m" : "t", o.mediaUrl || (o.conteudo ?? "")]);
}

/** Um item desta fila que CHEGOU a chamar o provider (pode ter gravado linha). */
interface ItemEncerrado {
  assinatura: string;
  /** Identidade lógica da mensagem (`_sendId`): o reenvio manual reusa a do original. */
  sendId: string | undefined;
  /** `Date.now()` do fim — relógio do CLIENTE, comparado só com o próprio cliente. */
  fimMs: number;
  /** Linha atribuída a este item (id do provider ou reivindicada pelo confirm). */
  messageId: string | null;
}

interface ItemEmVoo {
  chamouProvider: boolean;
  assinatura: string | null;
  sendId: string | undefined;
  messageId: string | null;
}

interface EstadoDaFila {
  interrompida: boolean;
  historico: ItemEncerrado[];
  atual: ItemEmVoo;
}

/**
 * Quanto tempo um item encerrado ainda pode ter linha na janela de um item
 * novo. A janela usa o timestamp do PROVIDER/servidor; o fim do item usa o
 * relógio do CLIENTE — a diferença entre os dois não é conhecida. Dez minutos
 * cobrem qualquer relógio de cliente razoável; errar para mais só produz falso
 * negativo (bolha de falha), nunca falso positivo.
 */
export const HORIZONTE_DE_ATRIBUICAO_MS = 10 * 60_000;

/**
 * Teto de ids que o confirm exclui na consulta (`.not in`, vai na URL). Acima
 * disto o confirm não consegue provar nada e devolve "não achei".
 */
export const MAX_IDS_EXCLUIDOS = 50;

const itemVazio = (): ItemEmVoo => ({ chamouProvider: false, assinatura: null, sendId: undefined, messageId: null });

/** Por QueryClient: cada teste cria o seu, e um mapa global vazaria entre casos. */
const estados = new WeakMap<QueryClient, Map<string, EstadoDaFila>>();

function estado(qc: QueryClient, escopo: string): EstadoDaFila {
  let porEscopo = estados.get(qc);
  if (!porEscopo) {
    porEscopo = new Map();
    estados.set(qc, porEscopo);
  }
  let atual = porEscopo.get(escopo);
  if (!atual) {
    atual = { interrompida: false, historico: [], atual: itemVazio() };
    porEscopo.set(escopo, atual);
  }
  return atual;
}

/** Só o que ainda pode ter linha numa janela nova. */
function historicoVivo(e: EstadoDaFila): ItemEncerrado[] {
  const limite = Date.now() - HORIZONTE_DE_ATRIBUICAO_MS;
  e.historico = e.historico.filter((i) => i.fimMs >= limite);
  return e.historico;
}

/** Itens pendentes (em voo + esperando) desta conversa. */
export function itensNaFila(qc: QueryClient, c: ConversaDaFila): number {
  return qc.isMutating({ mutationKey: chaveDaFila(c), exact: true });
}

export function filaInterrompida(qc: QueryClient, c: ConversaDaFila): boolean {
  return estado(qc, escopoDaFila(c)).interrompida;
}

export function interromperFila(qc: QueryClient, c: ConversaDaFila): void {
  estado(qc, escopoDaFila(c)).interrompida = true;
}

/**
 * O item em voo vai chamar o provider agora. Chamar IMEDIATAMENTE antes do
 * POST: a partir daqui ele pode ter gravado linha, com ou sem id na resposta.
 */
export function registrarTentativa(qc: QueryClient, c: ConversaDaFila, assinatura: string, sendId: string | undefined): void {
  const e = estado(qc, escopoDaFila(c));
  e.atual.chamouProvider = true;
  e.atual.assinatura = assinatura;
  e.atual.sendId = sendId;
}

/** A linha do item em voo — id do provider OU a que o confirm reivindicou. */
export function registrarConfirmado(qc: QueryClient, c: ConversaDaFila, messageId: string): void {
  estado(qc, escopoDaFila(c)).atual.messageId = messageId;
}

/** Ids já atribuídos a itens desta fila (dentro do horizonte). */
export function idsJaConfirmados(qc: QueryClient, c: ConversaDaFila): readonly string[] {
  return historicoVivo(estado(qc, escopoDaFila(c)))
    .map((i) => i.messageId)
    .filter((id): id is string => id !== null);
}

/** Margem do `ts` do item: o timestamp do provider tem precisão de segundo. */
const MARGEM_DE_RELOGIO_MS = 1000;

/**
 * Início da janela em que o `confirm` procura a linha deste item: `ts - 1 s`.
 * Sem corte pelo fim do item anterior — a separação entre itens é por CONTAGEM
 * (`provaDeConfirmacao`), que não depende de relógio nem de truncamento.
 */
export function inicioDaJanelaDeConfirmacao(timestampDoItem: string | null | undefined): string {
  return new Date(new Date(timestampDoItem ?? Date.now()).getTime() - MARGEM_DE_RELOGIO_MS).toISOString();
}

/**
 * O que o confirm precisa provar para o item em voo — ou `null` quando não dá
 * para provar nada (aí ele não confirma).
 *
 * Regra: toda linha da janela com a assinatura do item, fora as já atribuídas
 * (`excluir`), veio do item em voo OU de um anterior desta fila que chamou o
 * provider sem deixar linha atribuída ("sem dono"). Cada anterior grava no
 * máximo uma linha. Logo, só há prova de que o item em voo saiu quando há MAIS
 * linhas do que anteriores sem dono: `minimoDeLinhas = semDono + 1`.
 *
 * - Anterior com o MESMO `sendId` é a mesma mensagem (reenvio): achar a linha
 *   dele é achar a deste item, não conta como sem dono.
 * - Anterior que nunca chamou o provider (interrompido, falha antes do POST)
 *   não está no histórico: não pode ter linha.
 * - Anterior com falha ambígua (pode ter saído) CONTA como sem dono.
 */
export function provaDeConfirmacao(
  qc: QueryClient,
  c: ConversaDaFila,
  assinatura: string,
  sendId: string | undefined,
): { excluir: readonly string[]; minimoDeLinhas: number } | null {
  const vivos = historicoVivo(estado(qc, escopoDaFila(c)));
  const excluir = vivos.map((i) => i.messageId).filter((id): id is string => id !== null);
  if (excluir.length > MAX_IDS_EXCLUIDOS) return null;
  const semDono = vivos.filter((i) => i.messageId === null && i.assinatura === assinatura && (sendId === undefined || i.sendId !== sendId)).length;
  return { excluir, minimoDeLinhas: semDono + 1 };
}

/**
 * Fecha um item (chamar no `onSettled`, quando ele AINDA conta como pendente).
 * Devolve `true` se era o último da fila — e aí a fila volta a aceitar envio
 * normal: uma interrupção vale para os itens que estavam esperando, não para
 * o próximo envio que o vendedor fizer depois de ver a falha.
 */
export function encerrarItem(qc: QueryClient, c: ConversaDaFila): boolean {
  const e = estado(qc, escopoDaFila(c));
  const { chamouProvider, assinatura, sendId, messageId } = e.atual;
  // Item que chamou o provider OU que ganhou linha (reconciliação de mídia) fica
  // na memória: a linha dele nunca pode servir de prova para outro item.
  if ((chamouProvider && assinatura !== null) || messageId !== null) {
    historicoVivo(e).push({ assinatura: assinatura ?? "", sendId, fimMs: Date.now(), messageId });
  }
  e.atual = itemVazio();
  const ultimo = itensNaFila(qc, c) <= 1;
  if (ultimo) e.interrompida = false;
  return ultimo;
}

// ─── Aviso ao sair ────────────────────────────────────────────────────────────

/**
 * Clientes com item em alguma fila. O aviso pergunta ao CACHE se ainda há
 * envio pendente, em vez de confiar num contador: uma mutação descartada
 * (cache limpo na troca de org, logout) não pode deixar o aviso preso.
 */
const clientesComFila = new Set<QueryClient>();

const pendentesNoCliente = (qc: QueryClient) => qc.isMutating({ mutationKey: [RAIZ_DA_FILA] });

function avisarAoSair(event: BeforeUnloadEvent): void {
  if (![...clientesComFila].some((qc) => pendentesNoCliente(qc) > 0)) return;
  event.preventDefault();
  // Chrome < 119 e Safari ainda exigem `returnValue` para mostrar o diálogo.
  event.returnValue = "";
}

function entrou(qc: QueryClient): void {
  clientesComFila.add(qc);
  // Mesma referência de função: registrar de novo é no-op.
  if (typeof window !== "undefined") window.addEventListener("beforeunload", avisarAoSair);
}

/** Chamado com o item já assentado (fora da contagem de pendentes). */
function saiu(qc: QueryClient): void {
  if (pendentesNoCliente(qc) === 0) clientesComFila.delete(qc);
  // Sem fila, sem listener: `beforeunload` registrado tira a página do bfcache.
  if (clientesComFila.size === 0 && typeof window !== "undefined") {
    window.removeEventListener("beforeunload", avisarAoSair);
  }
}

// ─── Execução ────────────────────────────────────────────────────────────────

/**
 * Põe um envio na fila da conversa e devolve a promessa do resultado.
 *
 * Rejeita com `FilaCheiaError` sem criar mutação quando a conversa já tem
 * `LIMITE_DA_FILA_POR_CONVERSA` itens.
 */
export async function enfileirarEnvio<TData, TVariables, TContext>(
  qc: QueryClient,
  conversa: ConversaDaFila,
  opcoes: MutationObserverOptions<TData, Error, TVariables, TContext>,
  variaveis: TVariables,
): Promise<TData> {
  if (itensNaFila(qc, conversa) >= LIMITE_DA_FILA_POR_CONVERSA) throw new FilaCheiaError();
  const observer = new MutationObserver<TData, Error, TVariables, TContext>(qc, {
    ...opcoes,
    mutationKey: chaveDaFila(conversa),
    scope: { id: escopoDaFila(conversa) },
  });
  entrou(qc);
  try {
    return await observer.mutate(variaveis);
  } finally {
    saiu(qc);
    // Solta a mutação para o gc do cache; sem isto o observer a seguraria.
    observer.reset();
  }
}
