/**
 * capability-manifest.ts
 *
 * The Copilot Builder's omniscient, drift-proof knowledge of every Copilot
 * capability. Derived from the single source of truth — the PLAYGROUND_TOOLS
 * registry and the PlaygroundData shape — so it can never reference a tool or
 * field that doesn't exist, nor silently miss a newly added one.
 *
 * See PRD #544 / Slice #546.
 */

import {
  PLAYGROUND_TOOLS,
  LEGACY_TOOL_IDS,
  DEFAULT_PROMPT_SECTIONS,
  type ToolParameter,
} from "@/components/copilot/playground/types";

/**
 * A real piece of org state a capability needs before it can actually do
 * anything. The Builder uses this to wire only what exists (resolving cheap
 * deps inline, warning + skipping the rest) instead of enabling phantom tools.
 * `null` = no external dependency.
 */
export type OrgDependency =
  | "knowledge_document"
  | "sz_chat_config"
  | "pipeline_stages"
  | "scheduling"
  | null;

/** Curated mapping of tool id → org dependency (mirrors backend tool gating). */
const TOOL_DEPENDENCY: Record<string, OrgDependency> = {
  ENVIAR_DOCUMENTO: "knowledge_document",
  TRANSFERIR_SZ_CHAT: "sz_chat_config",
  MOVER_CARD: "pipeline_stages",
  AGENDAR_REUNIAO: "scheduling",
};

/**
 * The judgement layer code can't derive: when and why the Builder should reach
 * for each capability. Drift-guarded — every non-legacy registry tool MUST have
 * an entry here, enforced by a unit test, so adding a tool forces adding guidance.
 */
export interface CapabilityGuide {
  whenToUse: string;
  notes?: string;
}

const CAPABILITY_GUIDE: Record<string, CapabilityGuide> = {
  QUALIFICAR_LEAD: {
    whenToUse:
      "Enable when the agent must score and qualify inbound leads against an ideal profile. Use as the lead shares info — register progressively, qualify once required fields are complete, disqualify with a reason when clearly out of profile.",
  },
  AGENDAR_REUNIAO: {
    whenToUse:
      "Enable when booking meetings is part of the goal. The agent should proactively propose a meeting once the lead shows clear interest (asks price, implementation, next steps) and book immediately on confirmation.",
    notes: "Needs a scheduling link / calendar configured to be useful.",
  },
  MOVER_CARD: {
    whenToUse:
      "Enable when the agent should advance leads through the funnel automatically as the conversation progresses. Auto-enabled whenever the agent has active pipes configured.",
    notes: "Use the org's real pipeline stages — never invent stage names.",
  },
  TRANSFERIR_HUMANO: {
    whenToUse:
      "Enable so the agent can hand off to a human when the lead explicitly asks, the question is too technical / not in the knowledge base, or the lead is frustrated or the conversation loops. The agent should summarise context before transferring.",
  },
  CRIAR_LEAD: {
    whenToUse:
      "Enable when unknown contacts may start conversations and should become leads. The agent creates the lead once it has a name plus at least one contact channel, extracting available info from the chat.",
  },
  PREENCHER_CAMPOS: {
    whenToUse:
      "Enable so the agent records relevant info into standard and custom lead fields as it surfaces naturally in conversation, without asking permission to save.",
  },
  TRANSFERIR_SZ_CHAT: {
    whenToUse:
      "Enable when the org routes off-commercial topics (support, finance, logistics) to other sectors via SZ.Chat. The agent informs the client and summarises context before transferring.",
    notes: "Requires an active sz_chat_config with team mappings.",
  },
  ENVIAR_DOCUMENTO: {
    whenToUse:
      "Enable when there is material in the knowledge base the agent should send (catalog, price table, proposal). Send on request, or proactively when the lead shows interest and relevant material exists.",
    notes: "Requires at least one ready document in the agent's knowledge base.",
  },
  CRIAR_CAMPO: {
    whenToUse:
      "Enable so the agent can create a new custom field on the fly when the lead provides relevant information that has no existing field, then fill its value.",
  },
  PAUSAR_ATENDIMENTO_HUMANO: {
    whenToUse:
      "Enable so the agent automatically pauses when a human team member takes over the conversation, resuming only after the configured idle duration. Recommended by default to avoid the agent talking over a human.",
  },
};

export interface ToolCapability {
  id: string;
  name: string;
  description: string;
  params: ToolParameter[];
  dependency: OrgDependency;
  guide: CapabilityGuide;
}

/** A writable prompt-section field the Builder fills with free text. */
export interface FieldCapability {
  key: string;
  guide: CapabilityGuide;
}

/** Drift-guarded guidance for each prompt section (keyed by PromptSections key). */
const FIELD_GUIDE: Record<string, CapabilityGuide> = {
  personality: {
    whenToUse:
      "Who the agent is — persona, tone of voice, how it speaks and behaves. Ground it in the company's real brand voice; keep it consistent across the conversation.",
  },
  objective: {
    whenToUse:
      "The agent's main mission, success criterion and limits. State what a good outcome looks like and what the agent must not attempt.",
  },
  flow: {
    whenToUse:
      "How the agent conducts the conversation — the steps and how to lead the lead from opening to the objective.",
  },
  products: {
    whenToUse:
      "Catalogue of products/services — descriptions, prices, differentiators. Fill from real material (site, catalog) when available. Optional.",
  },
  instructions: {
    whenToUse:
      "Hard do's and don'ts — strict rules and guardrails the agent must always follow.",
  },
};

export interface CapabilityManifest {
  tools: ToolCapability[];
  fields: FieldCapability[];
}

export function buildCapabilityManifest(): CapabilityManifest {
  const tools: ToolCapability[] = PLAYGROUND_TOOLS
    .filter((t) => !LEGACY_TOOL_IDS.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      params: t.parameters,
      dependency: TOOL_DEPENDENCY[t.id] ?? null,
      guide: CAPABILITY_GUIDE[t.id],
    }));

  const fields: FieldCapability[] = Object.keys(DEFAULT_PROMPT_SECTIONS).map((key) => ({
    key,
    guide: FIELD_GUIDE[key],
  }));

  return { tools, fields };
}

/**
 * An LLM function-calling definition the Builder may invoke to manipulate the
 * Copilot config. Derived entirely from the manifest so the LLM can never
 * target a tool or section that doesn't exist.
 */
export interface BuilderToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; enum?: string[]; description?: string }>;
    required: string[];
  };
}

export function buildBuilderToolDefs(manifest: CapabilityManifest): BuilderToolDef[] {
  return [
    {
      name: "enable_tool",
      description:
        "Enable one of the Copilot agent's tools and set its usage instruction.",
      input_schema: {
        type: "object",
        properties: {
          tool_id: {
            type: "string",
            enum: manifest.tools.map((t) => t.id),
            description: "Which Copilot tool to enable.",
          },
          instruction: {
            type: "string",
            description: "When/how the agent should use this tool.",
          },
        },
        required: ["tool_id"],
      },
    },
    {
      name: "set_prompt_section",
      description: "Write the text of one of the agent's prompt sections.",
      input_schema: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: manifest.fields.map((f) => f.key),
            description: "Which prompt section to write.",
          },
          text: {
            type: "string",
            description: "The section content.",
          },
        },
        required: ["section", "text"],
      },
    },
  ];
}
