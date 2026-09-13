import { usePersistedState } from "@/shared/hooks/usePersistedState";

/**
 * Antes / Depois da tela de Leads — chave de validação visual do CTO.
 *
 * Persistida por usuário e por org (`usePersistedState`), nunca no banco: é
 * uma preferência de quem está olhando, não um estado do produto. Quando a
 * versão nova for aprovada, este hook e o ramo "antes" saem juntos.
 *
 * Vive fora do arquivo do componente por causa do fast refresh
 * (react-refresh/only-export-components).
 */
export type LeadsUiVersion = "antes" | "depois";

const DEFAULT: { version: LeadsUiVersion } = { version: "depois" };

export function useLeadsUiVersion() {
  const [state, setState] = usePersistedState("leads-ui", DEFAULT);
  const version: LeadsUiVersion = state.version === "antes" ? "antes" : "depois";
  return [version, (v: LeadsUiVersion) => setState({ version: v })] as const;
}
