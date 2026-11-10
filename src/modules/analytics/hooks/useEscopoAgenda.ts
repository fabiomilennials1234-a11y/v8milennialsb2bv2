import { createContext, useCallback, useContext } from "react";
import { useIdentity, isVirtualTeamMember } from "@/modules/identity";
import { usePersistedState } from "@/shared/hooks/usePersistedState";

/**
 * Quem vê qual agenda (Café Jurerê, 10/11):
 *   - membro: só a dele, sempre — sem controle na tela (e a RLS garante);
 *   - admin: toggle "Meu" (só as dele) / "Todos" (a equipe inteira).
 *
 * Independente das abas "Central da equipe"/"Minha central" do Comando: a
 * agenda tem o próprio controle, pedido explícito. Master sem `team_member`
 * real não tem "Meu" a que se referir — fica em "Todos", sem controle.
 *
 * Um estado só para a tela inteira (tabela, resumo e indicadores leem do mesmo
 * contexto): dois `usePersistedState` separados divergiriam no clique.
 */
export type VisaoAgenda = "meu" | "todos";

export const OPCOES_VISAO_AGENDA = [
  { value: "meu", label: "Meu" },
  { value: "todos", label: "Todos" },
] as const satisfies ReadonlyArray<{ value: VisaoAgenda; label: string }>;

/** A escolha dura um mês: é preferência de trabalho, não filtro do momento. */
const TTL_DA_ESCOLHA_MS = 30 * 24 * 60 * 60 * 1000;

export interface EscopoAgenda {
  /** O toggle aparece? Só para admin com membro real. */
  podeAlternar: boolean;
  visao: VisaoAgenda;
  setVisao: (v: VisaoAgenda) => void;
  /** O que vai para as RPCs (`p_somente_meus`). */
  somenteMeus: boolean;
  /** A tela mostra a equipe (rótulo "Equipe", dono de cada agenda). */
  vendoEquipe: boolean;
}

/** Regra pura — testável sem React. */
export function resolverEscopoAgenda(input: {
  isAdmin: boolean;
  temMembroReal: boolean;
  escolhida: unknown;
}): Omit<EscopoAgenda, "setVisao"> {
  const { isAdmin, temMembroReal } = input;
  const podeAlternar = isAdmin && temMembroReal;
  const visao: VisaoAgenda = !isAdmin
    ? "meu"
    : !temMembroReal
      ? "todos"
      : input.escolhida === "meu" || input.escolhida === "todos"
        ? input.escolhida
        : "todos";
  return { podeAlternar, visao, somenteMeus: visao === "meu", vendoEquipe: visao === "todos" };
}

/** Monta o escopo (uma vez, no topo da tela). */
export function useEstadoEscopoAgenda(): EscopoAgenda {
  const { isAdmin, teamMemberId, isLoading } = useIdentity();
  const temMembroReal = !!teamMemberId && !isVirtualTeamMember(teamMemberId);
  const [salva, setSalva] = usePersistedState<VisaoAgenda>("visao-meu-todos:agenda", "todos", {
    ttlMs: TTL_DA_ESCOLHA_MS,
    enabled: !isLoading && isAdmin && temMembroReal,
  });
  // Enquanto a identidade carrega, fail-closed: "meu".
  const base = isLoading
    ? { podeAlternar: false, visao: "meu" as const, somenteMeus: true, vendoEquipe: false }
    : resolverEscopoAgenda({ isAdmin, temMembroReal, escolhida: salva });
  const setVisao = useCallback((v: VisaoAgenda) => setSalva(v === "meu" ? "meu" : "todos"), [setSalva]);
  return { ...base, setVisao };
}

const EscopoAgendaContext = createContext<EscopoAgenda | null>(null);
export const EscopoAgendaProvider = EscopoAgendaContext.Provider;

/** Lê o escopo da tela. Sem provedor (teste, story), vale o do membro: só as minhas. */
export function useEscopoAgenda(): EscopoAgenda {
  return (
    useContext(EscopoAgendaContext) ?? {
      podeAlternar: false,
      visao: "meu",
      setVisao: () => {},
      somenteMeus: true,
      vendoEquipe: false,
    }
  );
}
