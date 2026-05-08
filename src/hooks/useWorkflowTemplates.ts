import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  definition: Record<string, unknown>;
  thumbnail_url: string | null;
  is_system: boolean;
  author_name: string | null;
  popularity: number;
  tags: string[];
  created_at: string;
}

export function useWorkflowTemplates(category?: string) {
  return useQuery<WorkflowTemplate[]>({
    queryKey: ["workflow-templates", category],
    queryFn: async () => {
      let q = (supabase.from as any)("workflow_templates")
        .select("*")
        .order("popularity", { ascending: false });

      if (category) q = q.eq("category", category);

      const { data, error } = await q;
      if (error) throw error;
      return data as WorkflowTemplate[];
    },
  });
}

export function useCloneWorkflowTemplate() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (templateId: string) => {
      const { data: template, error: fetchErr } = await (supabase.from as any)("workflow_templates")
        .select("name, definition")
        .eq("id", templateId)
        .single();
      if (fetchErr) throw fetchErr;

      const { data, error } = await supabase
        .from("workflows")
        .insert({
          organization_id: organization!.id,
          name: `${template.name} (cópia)`,
          definition: template.definition,
          is_active: false,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Workflow criado a partir do template");
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}
