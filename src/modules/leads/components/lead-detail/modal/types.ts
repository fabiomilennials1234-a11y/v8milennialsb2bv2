/**
 * Tipos locais do modal redesenhado de lead.
 *
 * Vivem aqui até a migration 20260517000000_lead_detail_modal_redesign.sql
 * ser aplicada em dev e os types.ts globais regenerados. Quando isso acontecer
 * migrar para `Tables<"lead_comments">` e `Enums<"qualification_tier">`.
 */

export type QualificationTier =
  | "diamante"
  | "ouro"
  | "prata"
  | "bronze"
  | "desqualificado";

export const QUALIFICATION_TIERS: QualificationTier[] = [
  "diamante",
  "ouro",
  "prata",
  "bronze",
  "desqualificado",
];

export interface LeadComment {
  id: string;
  organization_id: string;
  lead_id: string;
  author_user_id: string | null;
  author_team_member_id: string | null;
  body: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  /**
   * O NEGÓCIO em que o comentário foi escrito — `pipeline_entries.id`.
   *
   * `null` quer dizer "comentário do lead": nasceu fora de um negócio (é o caso
   * dos 2.885 que já existiam quando a coluna foi criada) ou o negócio saiu do
   * funil, e a FK é `ON DELETE SET NULL` para que o texto sobreviva ao card.
   *
   * Opcional no tipo, e não `| null` obrigatório, porque o front é publicado
   * por merge automático enquanto a migration é manual: entre um e outro o
   * `select("*")` volta sem a coluna. Quem lê trata ausente como `null`.
   */
  pipeline_entry_id?: string | null;
}

export interface LeadCommentWithAuthor extends LeadComment {
  author?: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
}

export interface LeadResponsibleMember {
  id: string;
  name: string;
  avatar_url?: string | null;
}
