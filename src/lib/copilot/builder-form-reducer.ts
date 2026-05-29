/**
 * builder-form-reducer.ts
 *
 * The pure core of the Copilot Builder's live-fill. Given the current form
 * state and an action the Builder emitted, returns the next state. Manually
 * edited fields are "locked" and never silently overwritten by the Builder.
 *
 * See PRD #544 / Slice #547.
 */

import type {
  PlaygroundData,
  PromptSections,
  PlaygroundToolState,
} from "@/components/copilot/playground/types";
import { buildCapabilityManifest } from "@/lib/copilot/capability-manifest";

const VALID_TOOL_IDS = new Set(buildCapabilityManifest().tools.map((t) => t.id));

export interface BuilderFormState {
  data: PlaygroundData;
  /** Field paths the user edited by hand — protected from Builder overwrite. */
  locked: string[];
}

export type BuilderAction =
  | {
      kind: "set_prompt_section";
      section: keyof PromptSections;
      text: string;
      override?: boolean;
    }
  | {
      kind: "enable_tool";
      toolId: string;
      instruction?: string;
    }
  | {
      kind: "user_edit";
      path: string;
    };

export function applyBuilderAction(
  state: BuilderFormState,
  action: BuilderAction,
): BuilderFormState {
  switch (action.kind) {
    case "set_prompt_section": {
      const path = `promptSections.${action.section}`;
      if (!action.override && state.locked.includes(path)) return state;
      return {
        ...state,
        data: {
          ...state.data,
          promptSections: {
            ...state.data.promptSections,
            [action.section]: action.text,
          },
        },
      };
    }

    case "enable_tool": {
      // Anti-hallucination: never enable a tool that isn't a real capability.
      if (!VALID_TOOL_IDS.has(action.toolId)) return state;
      const existing: PlaygroundToolState | undefined = state.data.tools[action.toolId];
      const tool: PlaygroundToolState = {
        enabled: true,
        config: existing?.config ?? {},
        instruction: action.instruction ?? existing?.instruction ?? "",
      };
      return {
        ...state,
        data: {
          ...state.data,
          tools: { ...state.data.tools, [action.toolId]: tool },
        },
      };
    }

    case "user_edit":
      if (state.locked.includes(action.path)) return state;
      return { ...state, locked: [...state.locked, action.path] };

    default:
      return state;
  }
}
