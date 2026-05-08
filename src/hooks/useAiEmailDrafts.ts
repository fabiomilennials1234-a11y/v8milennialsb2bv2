import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type EmailStyle = "formal" | "casual" | "follow_up" | "proposal" | "intro";

export interface AiEmailDraft {
  id: string;
  style: EmailStyle;
  generated_subject: string | null;
  generated_body: string | null;
  model_used: string | null;
  tokens_used: number | null;
  created_at: string;
}

export function useGenerateEmailDraft() {
  const { organization } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      deal_id?: string;
      lead_id?: string;
      style: EmailStyle;
      prompt?: string;
      context_snapshot?: Record<string, unknown>;
    }) => {
      const { data, error } = await (supabase.from as any)("ai_email_drafts")
        .insert({
          organization_id: organization!.id,
          deal_id: input.deal_id ?? null,
          lead_id: input.lead_id ?? null,
          style: input.style,
          prompt: input.prompt ?? null,
          context_snapshot: input.context_snapshot ?? {},
          created_by: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      const { data: draft, error: fnErr } = await supabase.functions.invoke("generate-ai-email-draft", {
        body: { draft_id: data.id, style: input.style, prompt: input.prompt },
      });
      if (fnErr) throw fnErr;
      return draft as AiEmailDraft;
    },
    onSuccess: () => {
      toast.success("Rascunho gerado pela IA");
    },
    onError: () => {
      toast.error("Erro ao gerar rascunho");
    },
  });
}

export function useAcceptEmailDraft() {
  return useMutation({
    mutationFn: async (draftId: string) => {
      const { error } = await (supabase.from as any)("ai_email_drafts")
        .update({ accepted: true })
        .eq("id", draftId);
      if (error) throw error;
    },
  });
}
