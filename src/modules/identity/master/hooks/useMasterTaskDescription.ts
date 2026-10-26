import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionsError } from "@/shared/errors";
import { useMasterAuth } from "./useMasterAuth";
import { PROMPT_COMPLEXITIES, type PromptComplexity } from "../lib/master-tasks";

export type DescriptionRequest = { title: string; context: string };
export interface DescriptionResult { description: string; complexity: PromptComplexity }

export function useMasterTaskDescription() {
  const { isFullMaster } = useMasterAuth();
  return useMutation({
    mutationFn: async (input: DescriptionRequest): Promise<DescriptionResult> => {
      if (!isFullMaster) throw new Error("Você não tem permissão para gerar descrições.");
      const { data, error } = await supabase.functions.invoke<DescriptionResult>("master-task-description", { body: input });
      if (error) throw await unwrapFunctionsError(error);
      if (typeof data?.description !== "string" || !data.description.trim() || data.description.length > 10000 || !PROMPT_COMPLEXITIES.includes(data.complexity)) {
        throw new Error("A descrição recebida é inválida. Tente gerar novamente.");
      }
      return { description: data.description.trim(), complexity: data.complexity };
    },
    retry: false,
  });
}
