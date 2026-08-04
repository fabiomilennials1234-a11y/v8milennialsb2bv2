-- ============================================================================
-- Promove o usuário da visualização a `admin` na org de teste. BRANCH EFÊMERA.
--
-- Por quê: o seed base cria o membro como `member`, e a aba de Leads recusa —
-- "Você não tem permissão para acessar esta página". O gate de rota lê a matriz
-- de papéis, e `member` não alcança a página.
--
-- `admin` é valor válido do enum `app_role` (admin, sdr, closer, agency, bdr,
-- cliente, member). `membro` e `master`, que o CLAUDE.md raiz cita, NÃO existem
-- neste enum e levantam `invalid input value for enum app_role`.
--
-- Uso:  node scripts/seed-branch.mjs --db-url "<url da branch>" \
--                                    --file supabase/qa-seed/card-do-lead-promove-admin.sql
-- ============================================================================

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

update public.team_members
   set role = 'admin'
 where id = 'aaaaaaaa-1111-4000-8000-000000000001';

do $$
declare v int;
begin
  select count(*) into v from public.team_members
   where id = 'aaaaaaaa-1111-4000-8000-000000000001' and role = 'admin';
  if v <> 1 then raise exception 'FALHA: membro não virou admin'; end if;
  raise notice '   OK(1): Vendedor da Casa agora é admin na org de teste.';
end $$;
