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
