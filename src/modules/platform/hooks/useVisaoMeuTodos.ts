import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/modules/identity";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { useFeatureFlag } from "./useFeatureFlag";
import {
  VISAO_MEU_TODOS_FLAG,
  VISAO_PADRAO,
  donoForcadoPelaVisao,
  normalizarVisao,
  visaoDisponivel,
  type SuperficieDaVisao,
  type Visao,
} from "../lib/visao-meu-todos";

/** A escolha dura um mês: é preferência de trabalho, não filtro do momento. */
const TTL_DA_ESCOLHA_MS = 30 * 24 * 60 * 60 * 1000;

export interface VisaoMeuTodos {
  /** O controle aparece? Admin + flag + membro da org. Fail-closed enquanto carrega. */
  disponivel: boolean;
  /** Visão efetiva — a padrão da superfície sempre que o controle não está disponível. */
  visao: Visao;
  setVisao: (v: Visao) => void;
  /** `team_members.id` a forçar como dono/responsável, ou `null` (segue o filtro da tela). */
  donoForcado: string | null;
  /**
   * A visão é a DEFINITIVA desta abertura: identidade e flag carregadas e, com
   * o controle disponível, a escolha salva já lida. Antes disso, `visao` pode
   * ser a padrão no lugar da salva — quem decide algo com base nela espera.
   */
  pronto: boolean;
}

export function useVisaoMeuTodos(superficie: SuperficieDaVisao): VisaoMeuTodos {
  const { isAdmin, teamMemberId, isLoading } = useIdentity();
  const { enabled: flag, isLoading: flagLoading } = useFeatureFlag(VISAO_MEU_TODOS_FLAG);
  const disponivel = !isLoading && !flagLoading && visaoDisponivel({ flag, isAdmin, teamMemberId });

  const padrao = VISAO_PADRAO[superficie];
  const [salva, setSalva] = usePersistedState<Visao>(`visao-meu-todos:${superficie}`, padrao, {
    ttlMs: TTL_DA_ESCOLHA_MS,
    enabled: disponivel,
  });
  const visao = disponivel ? normalizarVisao(salva, padrao) : padrao;
  const setVisao = useCallback((v: Visao) => setSalva(normalizarVisao(v, padrao)), [setSalva, padrao]);

  // O `usePersistedState` lê a escolha salva num effect do commit em que o
  // controle fica disponível; este effect roda logo depois do dele, no mesmo
  // commit, então o render seguinte já traz a escolha E o `pronto`.
  const [lida, setLida] = useState(false);
  useEffect(() => {
    if (disponivel) setLida(true);
  }, [disponivel]);
  const pronto = !isLoading && !flagLoading && (!disponivel || lida);

  return { disponivel, visao, setVisao, donoForcado: donoForcadoPelaVisao(disponivel, visao, teamMemberId), pronto };
}
