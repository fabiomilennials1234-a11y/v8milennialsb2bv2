/**
 * wizardSections — declarative registry for the Copilot v2 ESPECIFICIDADES tab
 * (redesign 2026-06-08). The flat 12-section wizard was regrouped into 4–5
 * product groups; NOTHING was removed — tone and capabilities moved to the BASE
 * tab (they belong to the factory core), and the new companyParticularities slot
 * sits next to products. There is NO free text anywhere except the escape-hatch.
 *
 * A group is required when it owns at least one hard-required field; the `*`
 * (gold) is driven by the field's own `required` flag, mirroring
 * missingHardForActivation() so the checklist and the form never disagree.
 */

import type { Archetype } from "../../lib/copilot-v2-config";
import {
  VENDEDOR_OBJECTIVES,
  CARTEIRA_OBJECTIVES,
  CARTEIRA_HANDOFF_TARGETS,
  BUSINESS_HOURS_OPTIONS,
  OBJECTIVE_LABELS,
  COMPANY_PARTICULARITIES_MAX,
} from "../../lib/copilot-v2-config";

export type FieldKind =
  | "text"
  | "textarea"
  | "particularities"
  | "chips"
  | "enum"
  | "objective-cards"
  | "segments"
  | "rubric"
  | "escape-hatch";

export interface FieldDef {
  kind: FieldKind;
  /** dot-path into the config object, e.g. "company.name", "products", "objective". */
  path: string;
  label?: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  rows?: number;
  options?: readonly string[];
  optionLabels?: Record<string, string>;
  /** Renders a "[Só Qualificador]"-style context chip in the sub-block header. */
  archetypeChip?: string;
}

export interface GroupDef {
  id: string;
  title: string;
  /** Short scannable subtitle under the group title. */
  subtitle?: string;
  /** A required group shows a gold `*` and is part of the activation checklist. */
  required: boolean;
  /** The "★ produtos e particularidades" group gets the accent-bar treatment. */
  featured?: boolean;
  fields: FieldDef[];
}

/** The Especificidades groups for an archetype, in canonical order. */
export function groupsFor(archetype: Archetype): GroupDef[] {
  const groups: GroupDef[] = [];

  // ── Grupo 1 · Sua empresa ──────────────────────────────────────────────────
  groups.push({
    id: "empresa",
    title: "Sua empresa",
    subtitle: "Como o agente se apresenta e o que ele diz que vocês fazem.",
    required: true,
    fields: [
      { kind: "text", path: "company.name", label: "Nome", required: true, maxLength: 80, hint: "Razão/marca como o lead conhece." },
      {
        kind: "textarea",
        path: "company.about",
        label: "Sobre",
        required: true,
        maxLength: 280,
        rows: 3,
        hint: "UMA frase: o que a empresa faz e pra quem.",
      },
    ],
  });

  // ── Grupo 2 · Produtos e particularidades ★ ────────────────────────────────
  groups.push({
    id: "produtos",
    title: "Produtos e particularidades",
    subtitle: "É aqui que o seu conhecimento faz o agente brilhar.",
    required: true,
    featured: true,
    fields: [
      {
        kind: "chips",
        path: "products",
        label: "Produtos",
        required: true,
        maxLength: 120,
        hint: "Linhas e categorias — 3 a 8 itens.",
        placeholder: "Ex.: Tubos de PVC · Conexões hidráulicas · Reservatórios",
      },
      {
        kind: "particularities",
        path: "companyParticularities",
        label: "Particularidades da empresa e do segmento",
        maxLength: COMPANY_PARTICULARITIES_MAX,
        rows: 5,
        hint: "Particularidades da sua empresa e do segmento do cliente: região, condições, diferenciais, assuntos que importam pra esse perfil.",
      },
    ],
  });

  // ── Grupo 3 · Quem você atende ─────────────────────────────────────────────
  const group3: GroupDef = {
    id: "publico",
    title: "Quem você atende",
    subtitle: "O perfil de cliente e o objetivo do agente com ele.",
    required: true,
    fields: [
      {
        kind: "textarea",
        path: "icp",
        label: "Cliente ideal (ICP)",
        required: true,
        maxLength: 300,
        rows: 3,
        hint: "Quem é o cliente ideal — ramo, porte, uso.",
      },
    ],
  };
  if (archetype === "qualificador") {
    group3.fields.push({
      kind: "rubric",
      path: "__rubric",
      label: "Rúbrica de qualificação",
      required: true,
      archetypeChip: "Só Qualificador",
      hint: "Os sinais e os cortes que definem cada tier. O agente extrai; a rúbrica decide.",
    });
  } else {
    group3.fields.push({
      kind: "objective-cards",
      path: "objective",
      label: "Objetivo do agente",
      required: true,
      options: archetype === "vendedor" ? VENDEDOR_OBJECTIVES : CARTEIRA_OBJECTIVES,
      optionLabels: OBJECTIVE_LABELS,
      archetypeChip: archetype === "vendedor" ? "Só Vendedor" : "Só Carteira",
      hint: "Define a postura do agente. Sem texto livre.",
    });
    if (archetype === "carteira") {
      group3.fields.push({
        kind: "segments",
        path: "segments",
        label: "Segmentos atendidos",
        archetypeChip: "Só Carteira",
        hint: "Quais segmentos de carteira este agente cobre.",
      });
    }
  }
  groups.push(group3);

  // ── Grupo 4 · Como vender ──────────────────────────────────────────────────
  const group4: GroupDef = {
    id: "venda",
    title: "Como vender",
    subtitle: "A política comercial, os reforços e os limites de atendimento.",
    required: archetype !== "qualificador",
    fields: [],
  };
  if (archetype !== "qualificador") {
    group4.fields.push({
      kind: "textarea",
      path: "commercialPolicy",
      label: "Política comercial",
      required: true,
      maxLength: 500,
      rows: 4,
      hint: "Única fonte autorizada de preço/prazo/MOQ além da base. Fora disso → transfere.",
    });
  }
  group4.fields.push(
    { kind: "chips", path: "socialProof", label: "Prova social", maxLength: 200, hint: "Reforço, nunca pressão. Só o que é verdade." },
    { kind: "chips", path: "objections", label: "Objeções", maxLength: 240, hint: "'Objeção → como responder'. 3 a 6 itens." },
    {
      kind: "enum",
      path: "businessHours",
      label: "Horário de atendimento",
      required: true,
      options: BUSINESS_HOURS_OPTIONS,
      hint: "Janela de atendimento.",
    },
  );
  if (archetype === "carteira") {
    group4.fields.push({
      kind: "enum",
      path: "handoffTarget",
      label: "Destino do handoff",
      required: true,
      options: CARTEIRA_HANDOFF_TARGETS,
      archetypeChip: "Só Carteira",
      hint: "Quem recebe a transferência estruturada.",
    });
  }
  groups.push(group4);

  // ── Grupo 5 · Observações (opcional, colapsado) ────────────────────────────
  groups.push({
    id: "observacoes",
    title: "Observações",
    subtitle: "Único campo livre — subordinado às regras de fábrica.",
    required: false,
    fields: [{ kind: "escape-hatch", path: "escapeHatchNotes" }],
  });

  return groups;
}
