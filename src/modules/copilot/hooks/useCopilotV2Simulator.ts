/**
 * useCopilotV2Simulator — Slice 9 simulator/eval-suite mutations (Copilot v2).
 * Thin client over the copilot-v2-simulate + evaluate-eval-suite edge fns. Both
 * are dry-run (zero writes); org comes from the auth context server-side.
 */

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  Archetype,
  CopilotV2Config,
  RubricRule,
} from "../lib/copilot-v2-config";
import type { SimulateResponse, EvalSuiteResponse } from "../lib/copilot-v2-sim";

export interface SimulateVars {
  archetype: Archetype;
  message: string;
  /** CREATE: in-flight draft config (with capabilities). EDIT: omit + pass agentId. */
  config?: CopilotV2Config;
  rubricRules?: RubricRule[];
  agentId?: string;
  seed?: Record<string, unknown>;
}

export function useSimulateTurn() {
  return useMutation<SimulateResponse, Error, SimulateVars>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("copilot-v2-simulate", { body: vars });
      if (error) throw error;
      return data as SimulateResponse;
    },
  });
}

export function useRunEvalSuite() {
  return useMutation<EvalSuiteResponse, Error, { archetype?: Archetype }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("evaluate-eval-suite", { body: vars });
      if (error) throw error;
      return data as EvalSuiteResponse;
    },
  });
}
