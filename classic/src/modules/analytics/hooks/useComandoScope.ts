import { useIdentity, isVirtualTeamMember } from "@/modules/identity";
import {
  escopoDoUsuario,
  type ComandoEscopo,
} from "@/modules/analytics/lib/comando-escopo";

export interface ComandoScope {
  /** `tudo` para admin e master; `meu` para o resto. */
  escopo: ComandoEscopo;
  /** Atalho de leitura — os cards decidem por ele o que rotular. */
  isAdmin: boolean;
  /**
   * `team_members.id` de quem está olhando.
   *
   * ⚠️ `null` para master e para gestor de portfólio: o front fabrica um id
   * virtual (`master-virtual-<userId>`) que NUNCA existe no banco (ADR-0021).
   * Este hook devolve `null` nesse caso em vez do id virtual, porque quem
   * consome usa isto para comparar contra FK — e comparar contra o virtual
   * devolveria lista vazia, que é o pior sintoma possível: parece "não há
   * nada" em vez de "não sei filtrar".
   *
   * Na prática o par é seguro: quem tem id virtual é sempre `isAdmin`, então
   * o escopo é `tudo` e nada é comparado.
   */
  meuTeamMemberId: string | null;
  /** `auth.users.id` — a agenda precisa dele para a fonte `meeting`. */
  meuUserId: string | null;
  isReady: boolean;
}

/**
 * Quem sou eu e o quanto eu posso ver, para os cards do Comando.
 *
 * Uma fonte só, porque a alternativa é cada card resolver identidade do seu
 * jeito — e foi assim que o produto ficou com três resolvedores de permissão
 * concorrentes.
 *
 * Master conta como admin, como em todo o resto do produto: `useIdentity`
 * devolve `isAdmin = isMaster || effectiveRole === "admin"`, e no banco
 * `is_master_user()` é a primeira linha de `is_org_admin`. As duas pontas
 * concordam de propósito.
 */
export function useComandoScope(): ComandoScope {
  const { isAdmin, teamMemberId, userId, isReady } = useIdentity();

  return {
    escopo: escopoDoUsuario(isAdmin),
    isAdmin,
    // Um id virtual não é um team_member; devolver `null` é mais honesto do
    // que devolver algo que nenhuma consulta vai casar. O detector é o do
    // próprio identity — não uma segunda cópia da regra do prefixo.
    meuTeamMemberId: isVirtualTeamMember(teamMemberId) ? null : teamMemberId,
    meuUserId: userId,
    isReady,
  };
}
