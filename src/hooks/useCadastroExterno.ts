/**
 * Hook for external cadastro integration (Sistema Millennials)
 *
 * - Enabled check via feature flag
 * - Push mutation calls cadastro-externo-push edge function
 */

import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

const MILENNIALS_ORG_ID = "6030520a-2ca7-477d-be89-55758e2cd808";

// ─── Types ──────────────────────────────────────────────────────

export interface CadastroExternoPushPayload {
  pipe_proposta_id: string;
  nome_cliente: string;
  razao_social: string;
  cnpj: string;
  cpf?: string;
  nicho: string;
  observacoes_gestor: string;
  investimento_previsto: number;
  comissao_vendas_percent: number;
  data_entrada: string;
  duracao_contrato_meses: number;
  dia_vencimento: number;
  produtos_contratados: string[];
  valores_produtos: Record<string, number>;
}

export interface CadastroExternoPushResult {
  success: boolean;
  cliente_id?: string;
  already_exists?: boolean;
  message?: string;
  produtos_criados?: string[];
  error?: string;
  code?: string;
  details?: Record<string, string>;
}

// ─── Enabled check ──────────────────────────────────────────────

export function useCadastroExternoEnabled(): boolean {
  const { hasFeature, isReady } = useOrgFeatures();
  const { organizationId } = useOrganization();
  // Org-bound integration — master bypass must not auto-enable for other orgs
  if (!isReady) return false;
  return hasFeature("external_cadastro") && organizationId === MILENNIALS_ORG_ID;
}

// ─── Push mutation ──────────────────────────────────────────────

export function useCadastroExternoPush() {
  return useMutation({
    mutationFn: async (payload: CadastroExternoPushPayload): Promise<CadastroExternoPushResult> => {
      const { data, error } = await supabase.functions.invoke("cadastro-externo-push", {
        body: payload,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as CadastroExternoPushResult;
    },
    onSuccess: (data) => {
      if (data.already_exists) {
        toast.info("Cliente já existe no sistema externo", {
          description: `ID: ${data.cliente_id}`,
        });
      } else {
        toast.success("Cliente cadastrado no sistema externo!", {
          description: data.message,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Erro ao cadastrar cliente", { description: error.message });
    },
  });
}
