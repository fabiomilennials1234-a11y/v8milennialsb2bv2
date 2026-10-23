/**
 * A decisão de interromper alguém.
 *
 * Este é o coração da feature de som — e o único lugar onde as regras moram.
 * Tudo o que quebra numa notificação sonora é decisão: tocou quando não devia,
 * calou quando devia tocar, tocou dez vezes pela mesma conversa. Nada disso
 * está no DOM, então nada disso se testa com DOM.
 *
 * A função é pura: o instante, a hora local, a visibilidade da aba e o registro
 * do último som entram por parâmetro. Teste de som com relógio real é teste que
 * falha sozinho de madrugada.
 */

import type { Aviso } from "./aviso-stream";
import { entregaDoTipo, type PreferenciasDeAviso } from "./preferencias-de-aviso";

export type Timbre = "mensagem" | "lead" | "reuniao" | "erro" | "sistema";

const TIMBRE_POR_TIPO: Record<string, Timbre> = {
  lead_message: "mensagem",
  transfer_to_human: "mensagem",
  lead_new: "lead",
  meeting_booked: "reuniao",
  meeting_soon: "reuniao",
  follow_up_due: "reuniao",
  follow_up_overdue: "reuniao",
  workflow_alert: "erro",
  cron_drift: "erro",
  scheduled_message_sent: "mensagem",
  scheduled_message_failed: "erro",
};

/** Automação parada atravessa o horário silencioso: parada de madrugada é prejuízo de manhã. */
const ATRAVESSA_O_SILENCIO = new Set(["workflow_alert", "cron_drift"]);

/**
 * O que exige reação em minutos — o resto conta no sino sem roubar a tela.
 * Mensagem agendada entra: quem agendou quer saber na hora que saiu (ou que
 * falhou e o lead ficou sem resposta), não dias depois abrindo o sino.
 */
const CANAL_QUENTE = new Set([
  "workflow_alert",
  "cron_drift",
  "lead_message",
  "lead_new",
  "transfer_to_human",
  "meeting_soon",
  "follow_up_due",
  "follow_up_overdue",
  "scheduled_message_sent",
  "scheduled_message_failed",
]);

/**
 * Rajada: enquanto a conversa está viva, o Aviso engorda em vez de nascer de
 * novo. Sem esta janela, cada mensagem de uma sequência tocaria — que é
 * exatamente o defeito que o coalescing existe para evitar.
 */
export const JANELA_DE_REPIQUE_MS = 60_000;

/**
 * Tipos cujo som é contido pela RAIZ da chave, não pela chave inteira.
 *
 * Mensagem agendada enviada nasce um Aviso por cliente e dia
 * (`sched_sent:<dia>:<cliente>`, Chamado fb8abe55): quem agendou precisa ver
 * cada cliente na lista, com o link da sua conversa. Só que dez agendamentos
 * às 09:00 são dez NASCIMENTOS no mesmo minuto — pela chave inteira, dez sons.
 * A raiz do dia (`sched_sent:<dia>`) devolve à rajada o som que ela tinha
 * quando era um cartão só: um.
 */
const RAIZ_DO_SOM = new Map<string, RegExp>([
  ["scheduled_message_sent", /^sched_sent:\d{4}-\d{2}-\d{2}(?=:|$)/],
]);

/**
 * A chave sob a qual o som é contido — e sob a qual quem toca registra o
 * último som. Para quase todo tipo é o próprio `group_key`. A chave legada
 * `sched_sent:<dia>`, do worker anterior ao Chamado fb8abe55, já é a raiz: a
 * ordem entre o deploy do front e o do worker não importa.
 */
export function chaveDeSom(aviso: Pick<Aviso, "type" | "group_key">): string | null {
  if (!aviso.group_key) return null;
  const raiz = RAIZ_DO_SOM.get(aviso.type)?.exec(aviso.group_key);
  return raiz ? raiz[0] : aviso.group_key;
}

export interface ContextoDeEntrega {
  preferencias: PreferenciasDeAviso;
  /** Aba em segundo plano continua ouvindo: quem está no Excel precisa ser chamado. */
  abaVisivel: boolean;
  /** Lead cuja conversa está aberta na tela agora, se houver. */
  conversaAbertaLeadId: string | null;
  /** Último som por chave de som (`chaveDeSom`), em epoch ms. */
  ultimoSomPorChave: Record<string, number>;
  /** Hora local de quem recebe, 0-23. */
  horaLocal: number;
  agora: number;
}

export interface Entrega {
  som: Timbre | null;
  cartao: boolean;
  /** Por que calou. Existe para depurar "não recebi" sem adivinhação. */
  motivo:
    | "entregue"
    | "tipo-sem-som"
    | "som-desligado"
    | "horario-silencioso"
    | "conversa-aberta"
    | "repique-recente";
}

export function timbreDoTipo(tipo: string): Timbre {
  return TIMBRE_POR_TIPO[tipo] ?? "sistema";
}

function dentroDoSilencio(hora: number, inicio: number | null, fim: number | null): boolean {
  if (inicio === null || fim === null) return false;
  // Janela que cruza a meia-noite (19h → 8h) é a regra, não a exceção.
  return inicio <= fim ? hora >= inicio && hora < fim : hora >= inicio || hora < fim;
}

export function decidirEntrega(
  aviso: Aviso,
  evento: "INSERT" | "UPDATE",
  contexto: ContextoDeEntrega,
): Entrega {
  const { preferencias } = contexto;
  const entrega = entregaDoTipo(preferencias, aviso.type);
  const quente = CANAL_QUENTE.has(aviso.type) && entrega.tela;

  const calar = (motivo: Entrega["motivo"]): Entrega => ({
    som: null,
    cartao: motivo === "conversa-aberta" ? false : quente,
    motivo,
  });

  // A conversa que já está na tela não precisa ser anunciada a quem a está lendo.
  if (
    preferencias.mute_active_conversation &&
    aviso.type === "lead_message" &&
    contexto.abaVisivel &&
    aviso.lead_id !== null &&
    aviso.lead_id === contexto.conversaAbertaLeadId
  ) {
    return calar("conversa-aberta");
  }

  if (!preferencias.sound_enabled) return calar("som-desligado");
  if (!entrega.som) return calar("tipo-sem-som");

  if (
    !ATRAVESSA_O_SILENCIO.has(aviso.type) &&
    dentroDoSilencio(contexto.horaLocal, preferencias.quiet_hours_start, preferencias.quiet_hours_end)
  ) {
    return calar("horario-silencioso");
  }

  // Pela chave inteira só o UPDATE repica: Aviso que nasce é assunto novo. Com
  // raiz de som, o nascimento repica também — cada cliente é um Aviso novo,
  // mas a rajada das 09:00 é uma só.
  if (evento === "UPDATE" || RAIZ_DO_SOM.has(aviso.type)) {
    const chave = chaveDeSom(aviso);
    const ultimo = chave ? contexto.ultimoSomPorChave[chave] : undefined;
    if (ultimo !== undefined && contexto.agora - ultimo < JANELA_DE_REPIQUE_MS) {
      return calar("repique-recente");
    }
  }

  return { som: timbreDoTipo(aviso.type), cartao: quente, motivo: "entregue" };
}
