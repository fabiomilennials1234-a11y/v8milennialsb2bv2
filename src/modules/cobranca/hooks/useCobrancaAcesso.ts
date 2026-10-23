import { useFeaturePermission } from "@/modules/identity";
import { useFeatureFlag } from "@/modules/platform";

/**
 * Quem pode o quê na área de cobrança (ADR-0040).
 *
 * Duas camadas, as duas obrigatórias: a flag da org
 * (`organizations.feature_flags.cobranca`, fail-closed, sem bypass de master)
 * e a permissão própria (`cobranca.view` / `cobranca.edit`; master e admin
 * passam, membro só com liberação). O banco confere as mesmas duas coisas em
 * toda RPC — isto aqui só decide o que a tela mostra.
 */
export const FLAG_COBRANCA = "cobranca";

export interface AcessoCobranca {
  carregando: boolean;
  habilitada: boolean;
  podeVer: boolean;
  podeEditar: boolean;
}

export function useCobrancaAcesso(): AcessoCobranca {
  const flag = useFeatureFlag(FLAG_COBRANCA);
  const ver = useFeaturePermission("cobranca.view");
  const editar = useFeaturePermission("cobranca.edit");
  return {
    carregando: flag.isLoading || ver.isLoading || editar.isLoading,
    habilitada: flag.enabled,
    podeVer: flag.enabled && ver.allowed,
    podeEditar: flag.enabled && editar.allowed,
  };
}
