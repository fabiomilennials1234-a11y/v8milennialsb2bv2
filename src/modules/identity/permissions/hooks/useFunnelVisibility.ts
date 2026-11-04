import { useIdentity } from "../../auth/hooks/useIdentity";
import {
  effectiveFunnelLevel,
  type FunnelVisibilityLevel,
} from "../lib/leadVisibility";

/**
 * O que o Funil mostra para a pessoa logada: `all` ou `own` (só os meus).
 *
 * Espelho do que o banco aplica (RLS RESTRICTIVE em `pipeline_entries`,
 * `pipeline.view_all`), limitado pelo nível de Leads — ver `leadVisibility.ts`.
 * A tela usa isto só para NÃO oferecer o que a RLS devolveria vazio; quem
 * garante o recorte é o banco.
 *
 * Admin e master (`isAdmin` inclui master) e gestor (membro virtual admin) são
 * `all`: o banco os libera por org. Enquanto as permissões carregam o retorno é
 * `all` — esconder filtro por palpite pisca a tela e não protege nada.
 */
export function useFunnelVisibilityLevel(): FunnelVisibilityLevel {
  const { isAdmin, features, isLoading } = useIdentity();
  if (isLoading || isAdmin) return "all";
  return effectiveFunnelLevel(features);
}
