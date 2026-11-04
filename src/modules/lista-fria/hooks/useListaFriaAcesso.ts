import { useFeaturePermission } from "@/modules/identity";
import { useFeatureFlag } from "@/modules/platform";

/**
 * Quem pode o quê na Lista Fria (ADR-0042).
 *
 * Duas camadas, as duas obrigatórias, no mesmo desenho da Cobrança: a flag da
 * org (`organizations.feature_flags.lista_fria`, fail-closed, sem bypass de
 * master) e a permissão própria (`lista_fria.view` / `lista_fria.edit`; master
 * e admin passam, membro só com liberação). O banco confere as mesmas duas
 * coisas em toda RPC e na RLS — isto aqui só decide o que a tela mostra.
 */
export const FLAG_LISTA_FRIA = "lista_fria";

export interface AcessoListaFria {
  carregando: boolean;
  habilitada: boolean;
  podeVer: boolean;
  podeEditar: boolean;
}

export function useListaFriaAcesso(): AcessoListaFria {
  const flag = useFeatureFlag(FLAG_LISTA_FRIA);
  const ver = useFeaturePermission("lista_fria.view");
  const editar = useFeaturePermission("lista_fria.edit");
  return {
    carregando: flag.isLoading || ver.isLoading || editar.isLoading,
    habilitada: flag.enabled,
    podeVer: flag.enabled && ver.allowed,
    podeEditar: flag.enabled && editar.allowed,
  };
}
