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
};

/** Automação parada atravessa o horário silencioso: parada de madrugada é prejuízo de manhã. */
const ATRAVESSA_O_SILENCIO = new Set(["workflow_alert", "cron_drift"]);

/** O que exige reação em minutos — o resto conta no sino sem roubar a tela. */
const CANAL_QUENTE = new Set(["workflow_alert", "cron_drift", "lead_message", "lead_new"]);

/**
 * Rajada: enquanto a conversa está viva, o Aviso engorda em vez de nascer de
 * novo. Sem esta janela, cada mensagem de uma sequência tocaria — que é
 * exatamente o defeito que o coalescing existe para evitar.
 */
export const JANELA_DE_REPIQUE_MS = 60_000;

export interface ContextoDeEntrega {
  preferencias: PreferenciasDeAviso;
  /** Aba em segundo plano continua ouvindo: quem está no Excel precisa ser chamado. */
  abaVisivel: boolean;
  /** Lead cuja conversa está aberta na tela agora, se houver. */
  conversaAbertaLeadId: string | null;
  /** Último som por chave de agrupamento, em epoch ms. */
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

  if (evento === "UPDATE") {
    const ultimo = aviso.group_key ? contexto.ultimoSomPorChave[aviso.group_key] : undefined;
    if (ultimo !== undefined && contexto.agora - ultimo < JANELA_DE_REPIQUE_MS) {
      return calar("repique-recente");
    }
  }

  return { som: timbreDoTipo(aviso.type), cartao: quente, motivo: "entregue" };
}
