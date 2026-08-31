/**
 * Escopo do Oráculo — o recorte de leitura, resolvido no servidor.
 *
 * Toda ferramenta de leitura recebe um Escopo derivado do JWT e NUNCA do corpo
 * da requisição (ADR-0032 §4). Hoje a edge function valida só pertencimento à
 * organização: qualquer `member` alcança o ranking, as conversas dos colegas e
 * os negócios perdidos da organização inteira. É esse vazamento que o Escopo
 * fecha.
 */

/** Recorte estrutural do ator. Espelha `AuthContext` de `user-auth.ts`. */
export interface OracleActor {
  userId: string;
  teamMemberId: string;
  organizationId: string;
  role: string;
  isMaster: boolean;
  isAdmin: boolean;
}

export interface OraclePermissions {
  /** `view_org_metrics` — nasce concedida a `admin`, negada a `member`. */
  viewOrgMetrics: boolean;
}

export type OracleScope =
  | { kind: "organization"; organizationId: string; teamMemberId: string | null }
  | { kind: "assigned"; organizationId: string; teamMemberId: string };

export function resolveScope(
  actor: OracleActor,
  perms: OraclePermissions,
): OracleScope {
  // O papel é o default; `view_org_metrics` é a alavanca que uma organização
  // usa para afrouxar o recorte sem que ninguém altere código (ADR-0032 §5).
  if (actor.isAdmin || perms.viewOrgMetrics) {
    return {
      kind: "organization",
      organizationId: actor.organizationId,
      teamMemberId: actor.teamMemberId || null,
    };
  }

  return {
    kind: "assigned",
    organizationId: actor.organizationId,
    teamMemberId: actor.teamMemberId,
  };
}
