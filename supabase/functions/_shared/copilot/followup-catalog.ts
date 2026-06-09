/**
 * Situation Catalog for Copilot Follow-up.
 *
 * The Torque-curated defaults — owning Archetype, default trigger delay, and a
 * default cadence (touches + base copy) — for each canonical Follow-up
 * Situation. The Organization enables/disables Situations and tunes basics on
 * top of these defaults; it never authors a Situation from scratch (ADR-0006).
 *
 * Copy guidelines: forward-moving re-engagement (end on a light question or a
 * concrete next step), never echo/re-promise prior context, brief, no dashes,
 * no emojis.
 */

import type { Archetype, SituationId } from "./followup-situations.ts";
import type { CadenceStep } from "./followup-cadence.ts";

export interface SituationDefault {
  situationId: SituationId;
  archetype: Archetype;
  /** Delay from the situation becoming true to the first touch. */
  defaultDelayHours: number;
  defaultDelayMinutes: number;
  /** Default cadence: ordered touches, each with base copy. */
  steps: CadenceStep[];
}

const CATALOG: Partial<Record<SituationId, SituationDefault>> = {
  new_lead_no_reply: {
    situationId: "new_lead_no_reply",
    archetype: "qualificador",
    defaultDelayHours: 3,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "Oi {nome}, tudo bem? Vi seu interesse e queria te ajudar. Posso te fazer uma pergunta rápida?" },
      { order: 2, delay_hours: 24, delay_minutes: 0, style: "value", message_template: "{nome}, quando for um bom momento me chama que eu te explico em 2 minutos. O que falta pra gente avançar?" },
      { order: 3, delay_hours: 72, delay_minutes: 0, style: "breakup", message_template: "{nome}, vou encerrar por aqui pra não incomodar. Se quiser retomar, é só chamar." },
    ],
  },
  qualified_no_meeting: {
    situationId: "qualified_no_meeting",
    archetype: "qualificador",
    defaultDelayHours: 24,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "{nome}, faltou só marcarmos nossa conversa. Qual horário te atende melhor essa semana, manhã ou tarde?" },
      { order: 2, delay_hours: 48, delay_minutes: 0, style: "value", message_template: "{nome}, consigo te encaixar ainda essa semana. Que dia fica bom pra você?" },
      { order: 3, delay_hours: 96, delay_minutes: 0, style: "breakup", message_template: "{nome}, deixo em aberto. Quando quiser marcar, me chama." },
    ],
  },
  cold_reengage: {
    situationId: "cold_reengage",
    archetype: "qualificador",
    defaultDelayHours: 168,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "curiosity", message_template: "Oi {nome}! Faz um tempo que não nos falamos. Surgiu algo que pode fazer sentido pra {empresa}. Quer que eu te conte?" },
      { order: 2, delay_hours: 336, delay_minutes: 0, style: "breakup", message_template: "{nome}, ainda faz sentido a gente conversar sobre isso? Se sim, é só responder." },
    ],
  },
  meeting_reminder: {
    situationId: "meeting_reminder",
    archetype: "vendedor",
    defaultDelayHours: 24,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "Oi {nome}! Passando pra confirmar nossa conversa marcada. Tá tudo certo do seu lado?" },
    ],
  },
  no_show_rebook: {
    situationId: "no_show_rebook",
    archetype: "vendedor",
    defaultDelayHours: 2,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "{nome}, acho que não conseguimos nos falar no horário. Sem problema! Qual dia fica melhor pra remarcar?" },
      { order: 2, delay_hours: 48, delay_minutes: 0, style: "value", message_template: "{nome}, sigo à disposição pra reagendar. Me diz um dia que te atende?" },
    ],
  },
  dormant_winback: {
    situationId: "dormant_winback",
    archetype: "carteira",
    defaultDelayHours: 720,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "value", message_template: "Oi {nome}! Faz um tempo desde seu último pedido. Quer que eu prepare uma reposição com condição especial pra {empresa}?" },
      { order: 2, delay_hours: 168, delay_minutes: 0, style: "curiosity", message_template: "{nome}, separei novidades que combinam com o que você costuma pedir. Quer dar uma olhada?" },
    ],
  },
  proposal_no_reply: {
    situationId: "proposal_no_reply",
    archetype: "vendedor",
    defaultDelayHours: 24,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "Oi {nome}, conseguiu ver a proposta que te enviei? Fico à disposição pra ajustar qualquer ponto." },
      { order: 2, delay_hours: 48, delay_minutes: 0, style: "value", message_template: "{nome}, quer que eu revise algum item da proposta pra fechar do jeito que faz sentido pra {empresa}?" },
      { order: 3, delay_hours: 96, delay_minutes: 0, style: "breakup", message_template: "{nome}, vou encerrar o acompanhamento por aqui. Se quiser retomar, é só chamar." },
    ],
  },
};

export function getSituationDefault(id: SituationId): SituationDefault {
  const def = CATALOG[id];
  if (!def) {
    throw new Error(`No catalog default for Follow-up Situation: ${id}`);
  }
  return def;
}
