/**
 * Payload de criação de lead que a RLS deixa o criador enxergar.
 *
 * ── O PROBLEMA ────────────────────────────────────────────────────────────
 * `insert(...).select()` vira `INSERT ... RETURNING`, e o RETURNING passa pela
 * política de SELECT de `leads`. Para um `member`, o lead só é visível se ele for
 * dono (SDR, closer, pré-venda, venda) ou tiver `leads.view_all` /
 * `see_unassigned_cards`. A Café Jurerê desligou os três para `member`; a tela
 * de criação deixa o responsável vazio, então o lead nascia sem dono, o RETURNING
 * era negado e o banco respondia 403 `new row violates row-level security policy`
 * (Rafaeli, 21/10: 7 tentativas). A tela mostrava isso como "sem permissão".
 *
 * ── A CORREÇÃO ────────────────────────────────────────────────────────────
 * 1. Sem dono informado, quem não é admin vira o responsável. `responsible_id`
 *    basta: o gatilho `fn_sync_canonical_assignment` o espelha em
 *    `sale_responsible_id`/`closer_id` no INSERT, e a RLS enxerga essas colunas.
 *    Admin já vê tudo e fica como está.
 * 2. O id nasce no cliente e o INSERT não pede RETURNING. Assim a criação não
 *    depende de o criador poder ler a linha — vale também quando ele atribui o
 *    lead a outra pessoa.
 */

/** Colunas de dono que a política de SELECT de `leads` consulta. */
const OWNER_COLUMNS = [
  "responsible_id",
  "sdr_id",
  "closer_id",
  "pre_sale_responsible_id",
  "sale_responsible_id",
] as const;

type OwnerColumn = (typeof OWNER_COLUMNS)[number];

export interface CreatorIdentity {
  /** `team_members.id` do criador. */
  teamMemberId: string | null;
  isAdmin: boolean;
}

type OwnerFields = Partial<Record<OwnerColumn, string | null>>;

export function hasOwner(lead: OwnerFields): boolean {
  return OWNER_COLUMNS.some((column) => !!lead[column]);
}

export function prepareLeadForCreate<T extends OwnerFields & { id?: string } & Record<string, unknown>>(
  lead: T,
  creator: CreatorIdentity,
  newId: () => string = () => crypto.randomUUID(),
): T & { id: string } {
  const owner =
    !creator.isAdmin && creator.teamMemberId && !hasOwner(lead)
      ? { responsible_id: creator.teamMemberId }
      : {};
  return { ...lead, ...owner, id: lead.id ?? newId() };
}
