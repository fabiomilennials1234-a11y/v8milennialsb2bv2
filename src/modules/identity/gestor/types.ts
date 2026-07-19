/**
 * Tipos locais mínimos das duas tabelas do Gestor de Portfólio (ADR-0021).
 *
 * Estas tabelas foram criadas em PROD (S1 #1137) mas NÃO estão no
 * `src/integrations/supabase/types.ts` — o types.ts gerado está atrás de PROD
 * (drift repo↔prod, ver MEMORY). Regenerar o arquivo inteiro (270KB) traria
 * mudanças não relacionadas; então definimos aqui só o shape necessário.
 * Ao consultar o client, usa-se `.from("<tabela>" as any)` + cast do resultado
 * (mesmo padrão de `useTeamMembers` para views ausentes do types gerado).
 */

/** Ator "scoped master": vive fora de `team_members`. Espelha `master_users`. */
export interface GestorRow {
  id: string;
  user_id: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

/** Vínculo Gestor↔Org, gerenciado pelo Master (whitelist de orgs). */
export interface GestorOrganizationRow {
  id: string;
  gestor_id: string;
  organization_id: string;
  created_at: string;
}
