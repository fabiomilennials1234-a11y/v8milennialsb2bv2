import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export function useRenomearNegocio({
  entryId,
  dealId,
  leadId,
  organizacaoId,
}: {
  entryId: string | null;
  dealId: string | null;
  leadId: string | null;
  organizacaoId: string | null | undefined;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ nome, alterarLead = false }: { nome: string; alterarLead?: boolean }) => {
      const titulo = nome.trim();
      if (!titulo) throw new Error("Informe o nome do negócio.");
      if (!entryId || !leadId || !organizacaoId) throw new Error("Negócio indisponível. Atualize a ficha.");

      // Entradas antigas podem não ter deals. A mesma RPC dos produtos cria
      // a identidade na entrada existente, sem abrir outro card no funil.
      let id = dealId;
      if (!id) {
        const { data, error } = await supabase.rpc("garantir_negocio_da_entrada" as never, {
          p_entry_id: entryId,
        } as never);
        if (error) throw new Error("Não foi possível preparar o negócio. Tente novamente.");
        id = data as unknown as string;
        if (!id) throw new Error("Negócio indisponível. Atualize a ficha.");
      }

      // Tipar as chaves evita usar `lead_id`: em deals, o vínculo é source_lead_id.
      const filtros = {
        id,
        source_lead_id: leadId,
        organization_id: organizacaoId,
      } satisfies Partial<Tables<"deals">>;
      const { error } = await supabase.from("deals")
        .update({ title: titulo })
        .match(filtros)
        .select("id")
        .single();
      if (error) throw new Error("Não foi possível salvar o nome do negócio. Tente novamente.");

      if (alterarLead) {
        const { error: leadError } = await supabase.from("leads")
          .update({ name: titulo })
          .eq("id", leadId)
          .eq("organization_id", organizacaoId)
          .select("id")
          .single();
        if (leadError) {
          throw new Error("O nome do negócio foi salvo, mas o nome do lead não foi alterado. Tente novamente.");
        }
      }
    },
    onSuccess: (_data, { alterarLead }) => {
      toast.success(alterarLead ? "Nomes do negócio e do lead atualizados." : "Nome do negócio atualizado.");
    },
    // Releitura também após falha parcial: o título pode já estar salvo.
    onSettled: async (_data, _error, { alterarLead }) => {
      const chaves: Array<readonly unknown[]> = [
        ["deal-card-extras", entryId], ["leads-deals"], ["pipeline-page"],
        ["pipeline_entries"], ["custom_pipe_entries"],
      ];
      if (alterarLead) chaves.push(["lead-detail", leadId], ["leads"], ["lead_by_id", leadId], ["lead_by_phone"]);
      await Promise.all(chaves.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}
