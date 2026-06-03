/**
 * wizardSections — declarative 12-section registry for the Copilot v2 wizard
 * (Slice 8), per the CTO-approved design spec. The wizard is data-driven: each
 * section lists typed fields; a generic renderer maps each field kind to a
 * shadcn primitive. There is NO free text anywhere except the escape-hatch.
 * Capability toggles are filtered to the per-archetype whitelist at render time.
 */

import type { Archetype, CapabilityFlag } from "../../lib/copilot-v2-config";
import {
  VENDEDOR_OBJECTIVES,
  CARTEIRA_OBJECTIVES,
  TONE_OPTIONS,
  BUSINESS_HOURS_OPTIONS,
  CARTEIRA_HANDOFF_TARGETS,
  OBJECTIVE_LABELS,
} from "../../lib/copilot-v2-config";

export type FieldKind =
  | "text"
  | "textarea"
  | "chips"
  | "enum"
  | "capabilities"
  | "segments"
  | "rubric"
  | "escape-hatch";

export interface FieldDef {
  kind: FieldKind;
  /** dot-path into the config object, e.g. "company.name", "products", "objective". */
  path: string;
  label?: string;
  hint?: string;
  maxLength?: number;
  options?: readonly string[];
  optionLabels?: Record<string, string>;
  /** capability flags surfaced by a "capabilities" field (filtered to whitelist). */
  flags?: readonly CapabilityFlag[];
}

export interface SectionDef {
  id: string;
  title: string;
  required: boolean;
  fields: FieldDef[];
}

/** The 12 sections (+ escape-hatch) for an archetype, in canonical order. */
export function sectionsFor(archetype: Archetype): SectionDef[] {
  const objectiveOptions = archetype === "vendedor" ? VENDEDOR_OBJECTIVES : CARTEIRA_OBJECTIVES;

  // Section 4 differs by archetype.
  const section4: SectionDef =
    archetype === "qualificador"
      ? { id: "rubrica", title: "Rúbrica de qualificação", required: true, fields: [{ kind: "rubric", path: "__rubric" }] }
      : {
          id: "objetivo",
          title: archetype === "vendedor" ? "Objetivo de venda" : "Objetivo por segmento",
          required: true,
          fields: [
            {
              kind: "enum",
              path: "objective",
              label: "Objetivo",
              options: objectiveOptions,
              optionLabels: OBJECTIVE_LABELS,
              hint: "Define a postura do agente. Sem texto livre.",
            },
            ...(archetype === "carteira"
              ? [{ kind: "segments" as const, path: "segments", label: "Segmentos atendidos" }]
              : []),
          ],
        };

  // Section 10 — transferência + notificação (carteira also picks a handoff target).
  const section10: SectionDef = {
    id: "transferencia",
    title: "Transferência + notificação",
    required: true,
    fields: [
      ...(archetype === "carteira"
        ? [
            {
              kind: "enum" as const,
              path: "handoffTarget",
              label: "Destino do handoff",
              options: CARTEIRA_HANDOFF_TARGETS,
              hint: "Quem recebe a transferência estruturada.",
            },
          ]
        : []),
      { kind: "capabilities", path: "capabilities", flags: ["can_transfer", "can_handoff", "can_set_tier"] },
    ],
  };

  return [
    {
      id: "empresa",
      title: "Empresa",
      required: true,
      fields: [
        { kind: "text", path: "company.name", label: "Nome", maxLength: 80, hint: "Razão/marca como o lead conhece." },
        {
          kind: "textarea",
          path: "company.about",
          label: "Sobre",
          maxLength: 280,
          hint: "UMA frase: o que a empresa faz e pra quem.",
        },
      ],
    },
    {
      id: "produtos",
      title: "Produtos",
      required: true,
      fields: [{ kind: "chips", path: "products", maxLength: 120, hint: "Uma linha por linha/categoria. 3 a 8 itens." }],
    },
    {
      id: "icp",
      title: "ICP",
      required: true,
      fields: [{ kind: "textarea", path: "icp", maxLength: 300, hint: "Quem é o cliente ideal — ramo, porte, uso." }],
    },
    section4,
    {
      id: "objecoes",
      title: "Objeções",
      required: false,
      fields: [{ kind: "chips", path: "objections", maxLength: 240, hint: "'Objeção → como responder'. 3 a 6 itens." }],
    },
    {
      id: "prova-social",
      title: "Prova social",
      required: false,
      fields: [{ kind: "chips", path: "socialProof", maxLength: 200, hint: "Reforço, nunca pressão. Só o que é verdade." }],
    },
    {
      id: "politica",
      title: "Política comercial",
      required: archetype !== "qualificador",
      fields: [
        {
          kind: "textarea",
          path: "commercialPolicy",
          maxLength: 500,
          hint: "Única fonte autorizada de preço/prazo/MOQ além da base. Fora disso → transfere.",
        },
      ],
    },
    {
      id: "midia",
      title: "Mídia de envio",
      required: false,
      fields: [{ kind: "capabilities", path: "capabilities", flags: ["can_send_media"] }],
    },
    {
      id: "agendamento",
      title: "Agendamento + funil",
      required: false,
      fields: [{ kind: "capabilities", path: "capabilities", flags: ["can_schedule_meeting", "can_move_stage", "can_fill_field"] }],
    },
    section10,
    {
      id: "tom",
      title: "Tom de voz",
      required: true,
      fields: [{ kind: "enum", path: "tone", options: TONE_OPTIONS[archetype], hint: "Estilo da comunicação." }],
    },
    {
      id: "horario",
      title: "Horário",
      required: true,
      fields: [{ kind: "enum", path: "businessHours", options: BUSINESS_HOURS_OPTIONS, hint: "Janela de atendimento." }],
    },
    {
      id: "observacoes",
      title: "Observações (escape-hatch)",
      required: false,
      fields: [{ kind: "escape-hatch", path: "escapeHatchNotes" }],
    },
  ];
}
