import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * CPF/CNPJ do lead editado no Torque (Chamado 93027ffb).
 *
 * O override mora em `lead_documents` e só é escrito pela RPC
 * `set_lead_document`; `upsell_clients.cnpj` continua espelho do ERP e única
 * chave de casamento com o Toth. Esta ficha lê os dois e mostra o override por
 * cima, com o valor do ERP ao lado.
 */
export const leadDocumentKey = (leadId: string | null) => ["lead-document", leadId] as const;

export interface LeadDocumentOverride {
  document: string;
  erpDocumentAtSet: string | null;
  erpWritebackStatus: string;
  updatedAt: string;
}

export function useLeadDocument(leadId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: leadDocumentKey(leadId),
    enabled: enabled && !!leadId,
    staleTime: 60_000,
    queryFn: async (): Promise<LeadDocumentOverride | null> => {
      const { data, error } = await supabase
        .from("lead_documents")
        .select("document,erp_document_at_set,erp_writeback_status,updated_at")
        .eq("lead_id", leadId!)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            document: data.document,
            erpDocumentAtSet: data.erp_document_at_set,
            erpWritebackStatus: data.erp_writeback_status,
            updatedAt: data.updated_at,
          }
        : null;
    },
  });
}

/**
 * Recusas que a RPC devolve com SQLSTATE próprio (o PostgREST repassa como
 * `code`). A mensagem do banco já é pt-BR; o mapa garante o texto mesmo que
 * ela mude, e nunca expõe o outro lead que já usa o documento.
 */
const RECUSAS: Record<string, string> = {
  PT422: "CPF/CNPJ inválido",
  PT409: "Este documento já está em outro cliente da organização",
  PT404: "Lead não encontrado. Atualize a ficha.",
  "42501": "Sem permissão para alterar o documento",
};

export function mensagemDoErroDeDocumento(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code && RECUSAS[error.code]) {
    // 42501 cobre "sem permissão" e "não edita este lead": a frase do banco diz qual.
    return error.code === "42501" && error.message ? error.message.replace(/\.$/, "") : RECUSAS[error.code];
  }
  return "Não foi possível salvar o documento";
}

export interface SetLeadDocumentResult {
  document: string | null;
  erp_document: string | null;
  overridden: boolean;
  erp_writeback_status: string | null;
}

export function useSetLeadDocument(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (document: string): Promise<SetLeadDocumentResult> => {
      if (!leadId) throw new Error("Lead não encontrado. Atualize a ficha.");
      // Chamado NO objeto: `const rpc = supabase.rpc` perde o receiver.
      const { data, error } = await supabase.rpc("set_lead_document", {
        p_lead_id: leadId,
        p_document: document,
      });
      if (error) throw new Error(mensagemDoErroDeDocumento(error));
      return data as unknown as SetLeadDocumentResult;
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: leadDocumentKey(leadId) }),
        // A chave do cadastro ERP leva a org de quem olha (`useOrganization`),
        // que para master é nula; casar pelo lead cobre os dois casos.
        qc.invalidateQueries({ queryKey: ["cafe-jurere-cadastro"], predicate: (q) => q.queryKey[2] === leadId }),
      ]);
    },
  });
}
