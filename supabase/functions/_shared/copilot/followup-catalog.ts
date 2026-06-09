/**
 * Situation Catalog for Copilot Follow-up.
 *
 * The Torque-curated defaults — owning Archetype, default trigger delay, and a
 * default cadence (touches + base copy) — for each canonical Follow-up
 * Situation. The Organization enables/disables Situations and tunes basics on
 * top of these defaults; it never authors a Situation from scratch (ADR-0006).
 *
 * Slice 1 ships only proposal_no_reply; the other five Situations land with
 * slices 4/5/6. Final wording is curated under #743 (HITL) — the copy here is a
 * structurally-valid default, not the approved brand copy.
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
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "Oi {nome}, tudo bem? Vi seu interesse e queria entender melhor como posso te ajudar. Posso te fazer só uma pergunta rápida?" },
      { order: 2, delay_hours: 24, delay_minutes: 0, style: "value", message_template: "{nome}, sei que a rotina corre. Quando for um bom momento, é só me responder por aqui que eu te explico tudo rapidinho." },
      { order: 3, delay_hours: 72, delay_minutes: 0, style: "breakup", message_template: "{nome}, vou encerrar por aqui pra não te incomodar. Se quiser retomar a qualquer momento, é só me chamar. 👋" },
    ],
  },
  qualified_no_meeting: {
    situationId: "qualified_no_meeting",
    archetype: "qualificador",
    defaultDelayHours: 24,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "{nome}, faltou só agendarmos nossa conversa. Qual horário fica melhor pra você essa semana?" },
      { order: 2, delay_hours: 48, delay_minutes: 0, style: "value", message_template: "{nome}, consigo encaixar você ainda essa semana. Manhã ou tarde te atende melhor?" },
      { order: 3, delay_hours: 96, delay_minutes: 0, style: "breakup", message_template: "{nome}, vou deixar em aberto por aqui. Quando quiser marcar, é só me chamar." },
    ],
  },
  cold_reengage: {
    situationId: "cold_reengage",
    archetype: "qualificador",
    defaultDelayHours: 168,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "curiosity", message_template: "Oi {nome}! Faz um tempo que não nos falamos. Surgiu uma novidade que pode fazer sentido pra {empresa} — quer que eu te conte?" },
      { order: 2, delay_hours: 336, delay_minutes: 0, style: "breakup", message_template: "{nome}, passando só pra saber se ainda faz sentido conversarmos. Se sim, é só responder por aqui." },
    ],
  },
  meeting_reminder: {
    situationId: "meeting_reminder",
    archetype: "vendedor",
    defaultDelayHours: 24,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "Oi {nome}! Passando pra lembrar da nossa conversa marcada. Tá tudo certo pra você?" },
    ],
  },
  no_show_rebook: {
    situationId: "no_show_rebook",
    archetype: "vendedor",
    defaultDelayHours: 2,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "direct", message_template: "{nome}, acho que não conseguimos nos falar no horário combinado. Sem problema! Quer remarcar pra um momento melhor?" },
      { order: 2, delay_hours: 48, delay_minutes: 0, style: "value", message_template: "{nome}, fico à disposição pra reagendar quando for melhor pra você. Qual dia te atende?" },
    ],
  },
  dormant_winback: {
    situationId: "dormant_winback",
    archetype: "carteira",
    defaultDelayHours: 720,
    defaultDelayMinutes: 0,
    steps: [
      { order: 1, delay_hours: 0, delay_minutes: 0, style: "value", message_template: "Oi {nome}! Faz um tempo desde seu último pedido. Quer que eu prepare uma reposição com condição especial pra {empresa}?" },
      { order: 2, delay_hours: 168, delay_minutes: 0, style: "curiosity", message_template: "{nome}, separei algumas novidades que combinam com o que você costuma pedir. Quer dar uma olhada?" },
    ],
  },
  proposal_no_reply: {
    situationId: "proposal_no_reply",
    archetype: "vendedor",
    defaultDelayHours: 24,
    defaultDelayMinutes: 0,
    steps: [
      {
        order: 1,
        delay_hours: 0,
        delay_minutes: 0,
        style: "direct",
        message_template:
          "Oi {nome}, tudo bem? Passando pra saber se conseguiu ver a proposta que te enviei.",
      },
      {
        order: 2,
        delay_hours: 48,
        delay_minutes: 0,
        style: "value",
        message_template:
          "{nome}, fico à disposição pra ajustar a proposta ao que faz sentido pra {empresa}. Quer que eu revise algum ponto?",
      },
      {
        order: 3,
        delay_hours: 96,
        delay_minutes: 0,
        style: "breakup",
        message_template:
          "{nome}, vou encerrar o acompanhamento por aqui pra não te incomodar. Se quiser retomar, é só me chamar.",
      },
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
