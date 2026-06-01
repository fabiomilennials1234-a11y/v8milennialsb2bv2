/**
 * Dry-Run Tool Engine — pure functions for previewing tool execution
 * without side effects in the CopilotPlayground.
 *
 * Two exports:
 * - formatToolCallsForDryRun: OpenRouter tool_calls → human-readable dry-run results
 * - buildPreviewTools: PlaygroundToolState → OpenRouter function-calling tool definitions
 */

import type { PlaygroundToolState } from "@/modules/copilot/components/playground/types";
import { PLAYGROUND_TOOLS } from "@/modules/copilot/components/playground/types";

// ─── Types ──────────────────────────────────────────────

/** Single tool_call from OpenRouter/OpenAI response */
export interface OpenRouterToolCall {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Formatted dry-run result */
export interface DryRunToolCall {
  name: string;
  parameters: Record<string, any>;
  humanDescription: string;
}

/** OpenRouter tool definition (function calling format) */
export interface OpenRouterToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

// ─── formatToolCallsForDryRun ───────────────────────────

/**
 * Converts raw OpenRouter tool_calls into human-readable dry-run results.
 * Returns empty array when input is nullish or empty.
 */
export function formatToolCallsForDryRun(
  toolCalls: OpenRouterToolCall[] | undefined | null,
): DryRunToolCall[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  return toolCalls.map((tc) => {
    const name = tc.function.name;
    let parameters: Record<string, any> = {};

    try {
      parameters = JSON.parse(tc.function.arguments);
    } catch {
      parameters = { _raw: tc.function.arguments };
    }

    return {
      name,
      parameters,
      humanDescription: buildHumanDescription(name, parameters),
    };
  });
}

/**
 * Generates human-readable description from tool name + params.
 * Maps known tools to concise summaries.
 */
function buildHumanDescription(
  name: string,
  params: Record<string, any>,
): string {
  switch (name) {
    case "advance_stage":
      return `MOVER_CARD → stage ${params.target_stage || "?"}${params.target_pipe ? ` (${params.target_pipe})` : ""}`;

    case "update_qualification_score":
      return `QUALIFICAR_LEAD → score ${params.score ?? "?"}${params.reason ? `, motivo: ${params.reason}` : ""}`;

    case "qualify_lead":
      return `QUALIFICAR_LEAD → qualificado${params.reason ? ` (${params.reason})` : ""}`;

    case "disqualify_lead":
      return `DESQUALIFICAR_LEAD → desqualificado${params.reason ? ` (${params.reason})` : ""}`;

    case "schedule_meeting":
      return `AGENDAR_REUNIAO → ${params.preferred_date || "?"}${params.preferred_time ? ` ${params.preferred_time}` : ""}`;

    case "confirm_meeting":
      return `CONFIRMAR_REUNIAO → ${params.confirmation_type || "?"}`;

    case "advance_confirmation_stage":
      return `MOVER_CONFIRMACAO → stage ${params.target_stage || "?"}`;

    case "transfer_to_human":
      return `TRANSFERIR_HUMANO → ${params.reason || "sem motivo"}`;

    case "update_lead":
      return `PREENCHER_CAMPOS → ${Object.entries(params.updates || params).map(([k, v]) => `${k}: ${v}`).join(", ") || "?"}`;

    case "create_lead":
      return `CRIAR_LEAD → ${params.name || "?"}`;

    case "search_knowledge":
      return `BUSCAR_KB → "${params.query || "?"}"`;

    case "send_document":
      return `ENVIAR_DOCUMENTO → ${params.document_id || "?"}${params.caption ? ` (${params.caption})` : ""}`;

    case "send_product_material":
      return `ENVIAR_MATERIAL → ${params.material_id || "?"}`;

    case "create_custom_field":
      return `CRIAR_CAMPO → ${params.field_name || "?"} (${params.field_type || "text"})`;

    case "transfer_sz_chat":
      return `TRANSFERIR_SETOR → ${params.target_team_name || "?"}`;

    default:
      return `${name} → ${JSON.stringify(params)}`;
  }
}

// ─── buildPreviewTools ──────────────────────────────────

/** Maps playground tool IDs to OpenRouter function definitions */
const TOOL_ID_TO_OPENROUTER: Record<
  string,
  (config: Record<string, any>) => OpenRouterToolDef[]
> = {
  QUALIFICAR_LEAD: () => [
    {
      type: "function",
      function: {
        name: "update_qualification_score",
        description: "Atualiza o score de qualificacao do lead (0-100).",
        parameters: {
          type: "object",
          properties: {
            score: { type: "number", description: "Score 0-100" },
            reason: { type: "string", description: "Motivo" },
          },
          required: ["score"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "qualify_lead",
        description: "Marca lead como qualificado.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Justificativa" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "disqualify_lead",
        description: "Marca lead como desqualificado.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Motivo" },
          },
        },
      },
    },
  ],

  AGENDAR_REUNIAO: () => [
    {
      type: "function",
      function: {
        name: "schedule_meeting",
        description: "Agenda reuniao com o lead.",
        parameters: {
          type: "object",
          properties: {
            preferred_date: { type: "string", description: "Data (YYYY-MM-DD)" },
            preferred_time: { type: "string", description: "Horario (HH:MM)" },
          },
          required: ["preferred_date"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "confirm_meeting",
        description: "Confirma presenca do lead na reuniao.",
        parameters: {
          type: "object",
          properties: {
            confirmation_type: {
              type: "string",
              enum: ["pre_confirmed", "confirmed"],
              description: "Tipo de confirmacao",
            },
          },
          required: ["confirmation_type"],
        },
      },
    },
  ],

  MOVER_CARD: (config) => {
    const pipe = config.pipe || "whatsapp";
    const stagesRaw = config.stages || "";
    const stages = stagesRaw
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (stages.length === 0) return [];

    return [
      {
        type: "function",
        function: {
          name: "advance_stage",
          description: `Move lead no funil ${pipe}. Etapas: ${stages.join(", ")}.`,
          parameters: {
            type: "object",
            properties: {
              target_stage: {
                type: "string",
                description: `Etapa destino: ${stages.join(", ")}`,
              },
              target_pipe: {
                type: "string",
                description: `Funil (default: ${pipe})`,
              },
            },
            required: ["target_stage"],
          },
        },
      },
    ];
  },

  ENVIAR_FOLLOWUP: () => [],

  TRANSFERIR_HUMANO: () => [
    {
      type: "function",
      function: {
        name: "transfer_to_human",
        description: "Transfere conversa para atendente humano.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Motivo" },
          },
          required: ["reason"],
        },
      },
    },
  ],

  CRIAR_LEAD: () => [
    {
      type: "function",
      function: {
        name: "create_lead",
        description: "Cria novo lead no CRM.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
            company: { type: "string" },
          },
          required: ["name"],
        },
      },
    },
  ],

  PREENCHER_CAMPOS: () => [
    {
      type: "function",
      function: {
        name: "update_lead",
        description: "Atualiza campos do lead no CRM.",
        parameters: {
          type: "object",
          properties: {
            updates: {
              type: "object",
              description: "Chave-valor dos campos a atualizar.",
              additionalProperties: { type: "string" },
            },
          },
          required: ["updates"],
        },
      },
    },
  ],

  CRIAR_CAMPO: () => [
    {
      type: "function",
      function: {
        name: "create_custom_field",
        description: "Cria campo personalizado no CRM.",
        parameters: {
          type: "object",
          properties: {
            field_name: { type: "string", description: "Nome do campo" },
            field_type: {
              type: "string",
              enum: ["text", "number", "date", "select", "boolean"],
            },
            field_options: {
              type: "array",
              items: { type: "string" },
              description: "Opcoes (se select)",
            },
            initial_value: { type: "string", description: "Valor inicial" },
          },
          required: ["field_name", "field_type"],
        },
      },
    },
  ],

  RESPONDER_FAQ: () => [
    {
      type: "function",
      function: {
        name: "search_knowledge",
        description: "Consulta base de conhecimento da empresa.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Termo de busca" },
          },
          required: ["query"],
        },
      },
    },
  ],
};

/**
 * Builds OpenRouter tool definitions from enabled playground tools.
 * Only includes tools that are enabled and have a valid mapping.
 * MOVER_CARD excluded when config has no stages.
 */
export function buildPreviewTools(
  tools: Record<string, PlaygroundToolState>,
): OpenRouterToolDef[] {
  const result: OpenRouterToolDef[] = [];

  for (const [toolId, state] of Object.entries(tools)) {
    if (!state.enabled) continue;

    const builder = TOOL_ID_TO_OPENROUTER[toolId];
    if (!builder) continue;

    const defs = builder(state.config || {});
    result.push(...defs);
  }

  return result;
}
