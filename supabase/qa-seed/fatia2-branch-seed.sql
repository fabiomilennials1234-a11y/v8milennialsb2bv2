-- ============================================================================
-- Seed + prova da fatia 2 numa BRANCH EFÊMERA. Nunca em prod.
--
-- Uso:  node scripts/seed-branch.mjs --db-url "<POSTGRES_URL_NON_POOLING>" \
--                                    --file supabase/qa-seed/fatia2-branch-seed.sql
--
-- Duas orgs de propósito: a segunda existe só para provar que responsável de
-- fora é recusado — o defeito que o M6 trava, e que em prod tem 1.594 linhas.
--
-- As asserções levantam exceção. Rodar sem erro É o resultado.
-- ============================================================================

-- ── Contexto de auth para a sessão do seed ─────────────────────────────────
--
-- Sem isto o INSERT em `team_members` morre com `access_denied` puro, e a pista
-- é ruim: quem levanta é `assert_org_member`, chamado lá no fundo da resolução
-- de quota que `enforce_seat_limit` dispara. O gatilho não é o que parece pelo
-- nome, e a mensagem não diz "assento".
--
-- `auth.role()` lê `request.jwt.claims`. O `postgres` da URL da branch não é
-- `service_role` nem master, então os guards fecham tudo. Aqui é legítimo:
-- banco efêmero, zero dado de cliente. Em prod isto seria escalar privilégio.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- ── Plano ──────────────────────────────────────────────────────────────────
--
-- Sem plano o INSERT em `team_members` morre com "Limite de seats atingido.
-- Seats pagos: 0" — `subscription_plans` nasce vazia na branch (o dump traz
-- schema, não linha). E o portão de features lê
-- `organizations.subscription_plan` (TEXTO) casado com `subscription_plans.name`
-- — não `organizations.feature_flags`; confundir os dois leva a conclusão errada
-- sobre quem enxerga o quê.
--
-- Espelha o `torque-v8` de prod, com `deals: false`: a rota `/negocios` foi
-- apagada no passo 3 do L2, e deixar a feature ligada só criaria um toggle que
-- não liga nada.
insert into public.subscription_plans (name, display_name, is_active, position, included_users, min_users, limits, features)
values ('torque-v8', 'Torque Copilot', true, 3, 3, 3,
        '{"max_leads":-1,"max_users":-1,"max_funnels":-1,"max_campaigns":-1,"max_copilot_agents":-1,"max_whatsapp_instances":-1,"max_documents_per_agent":-1}'::jsonb,
        '{"chat":true,"deals":false,"leads":true,"review":true,"copilot":true,"funnels":true,"oraculo":true,"carteira":true,"products":true,"analytics":true,"marketing":true,"automations":true,"commissions":true,"performance":true,"voice_calls":false,"tv_dashboard":true,"whatsapp_bulk":true,"message_templates":true,"customer_portfolio":true,"scheduled_messages":true}'::jsonb)
on conflict (name) do update set limits = excluded.limits, features = excluded.features, is_active = true;

-- ── Org A (a que testa) ────────────────────────────────────────────────────
insert into public.organizations (id, name, slug, timezone, subscription_plan)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Org Teste Fatia 2', 'org-teste-fatia2',
        'America/Sao_Paulo', 'torque-v8')
on conflict (id) do nothing;

-- ── Org B (só para o caso cross-org) ───────────────────────────────────────
insert into public.organizations (id, name, slug, timezone)
values ('bbbbbbbb-0000-4000-8000-000000000002', 'Org Vizinha', 'org-vizinha', 'America/Sao_Paulo')
on conflict (id) do nothing;

-- `role` é `app_role`, e o enum REAL é (medido na branch, 2026-08-03):
--   admin, sdr, closer, agency, bdr, cliente, member
-- O `CLAUDE.md` raiz diz "Roles código: SEMPRE admin, master, membro" — as duas
-- últimas não existem neste enum. `membro` levanta
-- `invalid input value for enum app_role`.
-- Re-dispara `sync_org_plan_quotas`. A fonte autoritativa de assento é
-- `org_quotas` (`resource_key='max_users'`), escrita por esse gatilho a partir
-- de `subscription_plans.limits`. A org acima pode ter nascido ANTES do plano
-- existir — nesse caso a quota foi calculada como 0 e ficou gravada, e
-- `enforce_seat_limit` recusa o primeiro membro com "Seats pagos: 0". Tocar a
-- org depois do plano recalcula. Escrever `org_quotas` na mão também
-- funcionaria, e seria pior: `effective_limit` é coluna GERADA.
update public.organizations set subscription_plan = 'torque-v8'
 where id in ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002');

insert into public.team_members (id, organization_id, name, role, is_active)
values ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Vendedor da Casa', 'member', true),
       ('bbbbbbbb-1111-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'Vendedor de Fora', 'member', true)
on conflict (id) do nothing;

-- ── Funis de sistema da Org A ──────────────────────────────────────────────
insert into public.pipelines (id, organization_id, name, slug, type)
values ('aaaaaaaa-2222-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Qualificação', 'whatsapp', 'system'),
       ('aaaaaaaa-2222-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Oportunidades', 'confirmacao', 'system'),
       ('aaaaaaaa-2222-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Orçamentos', 'propostas', 'system')
on conflict (id) do nothing;

insert into public.pipeline_stages (organization_id, pipeline_type, stage_key, name, position, is_active)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'whatsapp',   'novo',       'Novo Lead',   0, true),
       ('aaaaaaaa-0000-4000-8000-000000000001', 'whatsapp',   'abordado',   'Abordado',    1, true),
       ('aaaaaaaa-0000-4000-8000-000000000001', 'confirmacao','marcada',    'Marcada',     0, true),
       ('aaaaaaaa-0000-4000-8000-000000000001', 'confirmacao','compareceu', 'Compareceu',  1, true),
       ('aaaaaaaa-0000-4000-8000-000000000001', 'propostas',  'enviada',    'Enviada',     0, true)
on conflict do nothing;
-- Sem a etapa `vendido` de propósito: `trg_pipeline_stages_system_stage_role`
-- carimba `stage_role='won'` nela, e `fn_pipeline_stages_guard_money_role`
-- (ADR-0017 §1) recusa criar etapa de dinheiro para quem não é admin da org,
-- master, service_role ou superusuário — o `postgres` da URL da branch não é
-- nenhum dos quatro, e o erro sai como `access_denied`. Nenhuma prova aqui
-- precisa de etapa de ganho.

-- ── O lead ─────────────────────────────────────────────────────────────────
insert into public.leads (id, organization_id, name, phone)
values ('aaaaaaaa-3333-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Cliente que Recompra', '5511999990000')
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- PROVAS
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Ingest não abre negócio (ADR-0023 decisão 3) ────────────────────────
-- O lead acabou de nascer por INSERT direto — o caminho que todo webhook usa.
-- Se algum gatilho ainda semeia card automaticamente, a decisão 3 está furada
-- na raiz e o resto do modelo não se sustenta.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.pipeline_entries
   where lead_id = 'aaaaaaaa-3333-4000-8000-000000000001';
  if v_n <> 0 then
    raise exception 'FAIL(1): lead recém-criado já tem % card(s). Automação está abrindo negócio — decisão 3 furada.', v_n;
  end if;
  raise notice 'OK(1): lead nasceu sem card. Ingest não abre negócio.';
end$$;


-- ── 2. A porta cria identidade + posição, ligadas, com título derivado ─────
do $$
declare v_deal uuid; v_title text; v_entry_deal uuid; v_esperado text;
begin
  v_deal := public.abrir_negocio(
    p_lead_id  => 'aaaaaaaa-3333-4000-8000-000000000001',
    p_pipe     => 'whatsapp',
    p_stage    => 'novo',
    p_owner_id => 'aaaaaaaa-1111-4000-8000-000000000001'
  );

  select title into v_title from public.deals where id = v_deal;
  v_esperado := public.fn_negocio_titulo_padrao(now(), 'America/Sao_Paulo');
  if v_title is distinct from v_esperado then
    raise exception 'FAIL(2): título "%" ≠ derivado "%".', v_title, v_esperado;
  end if;
  if v_title ilike '%qualifica%' then
    raise exception 'FAIL(2): título herdou o nome do funil — exatamente o que a decisão 9 rejeita.';
  end if;

  select deal_id into v_entry_deal from public.pipeline_entries
   where lead_id = 'aaaaaaaa-3333-4000-8000-000000000001'
     and pipeline_id = 'aaaaaaaa-2222-4000-8000-000000000001';
  if v_entry_deal is distinct from v_deal then
    raise exception 'FAIL(2): card não ficou ligado ao negócio (deal_id=%, esperado %).', v_entry_deal, v_deal;
  end if;

  raise notice 'OK(2): negócio "%" criado, card ligado por deal_id.', v_title;
end$$;


-- ── 3. RECOMPRA — o motivo da fatia inteira ────────────────────────────────
-- Antes do M1, três cadeados de unicidade proibiam o mesmo lead ter dois cards
-- no mesmo funil: o cliente que comprou em março e voltou em setembro não tinha
-- onde ser registrado, e o vendedor reusava o card de março (apagando a primeira
-- venda) ou duplicava a pessoa.
do $$
declare v_deal2 uuid; v_cards int; v_negocios int;
begin
  v_deal2 := public.abrir_negocio(
    p_lead_id  => 'aaaaaaaa-3333-4000-8000-000000000001',
    p_pipe     => 'whatsapp',
    p_stage    => 'novo',
    p_owner_id => 'aaaaaaaa-1111-4000-8000-000000000001'
  );

  select count(*) into v_cards from public.pipeline_entries
   where lead_id = 'aaaaaaaa-3333-4000-8000-000000000001'
     and pipeline_id = 'aaaaaaaa-2222-4000-8000-000000000001';
  select count(distinct deal_id) into v_negocios from public.pipeline_entries
   where lead_id = 'aaaaaaaa-3333-4000-8000-000000000001'
     and pipeline_id = 'aaaaaaaa-2222-4000-8000-000000000001';

  if v_cards <> 2 or v_negocios <> 2 then
    raise exception 'FAIL(3): esperava 2 cards e 2 negócios no mesmo funil, veio % e %. Recompra ainda travada.', v_cards, v_negocios;
  end if;
  raise notice 'OK(3): dois negócios abertos no MESMO funil para o MESMO lead. Recompra representável.';
end$$;


-- ── 4. Responsável de outra org é recusado ─────────────────────────────────
do $$
declare v_deal uuid; v_antes int; v_depois int;
begin
  select count(*) into v_antes from public.deals;
  begin
    v_deal := public.abrir_negocio(
      p_lead_id  => 'aaaaaaaa-3333-4000-8000-000000000001',
      p_pipe     => 'propostas',
      p_stage    => 'enviada',
      p_owner_id => 'bbbbbbbb-1111-4000-8000-000000000002'   -- membro da Org B
    );
    raise exception 'FAIL(4): aceitou responsável de outra organização.';
  exception when check_violation then
    null;  -- esperado
  end;

  -- E não pode ter deixado negócio órfão para trás: a recusa é da transação inteira.
  select count(*) into v_depois from public.deals;
  if v_depois <> v_antes then
    raise exception 'FAIL(4): a recusa deixou % negócio(s) órfão(s) — a transação não foi desfeita.', v_depois - v_antes;
  end if;
  raise notice 'OK(4): responsável cross-org recusado, e sem negócio órfão.';
end$$;


-- ── 5. Carteira não entra por esta porta (decisão 8) ───────────────────────
do $$
declare v_deal uuid;
begin
  begin
    v_deal := public.abrir_negocio(
      p_lead_id => 'aaaaaaaa-3333-4000-8000-000000000001',
      p_pipe    => 'upsell',
      p_stage   => 'qualquer'
    );
    raise exception 'FAIL(5): a porta aceitou `upsell`.';
  exception when invalid_parameter_value then
    raise notice 'OK(5): `upsell` recusado — carteira entra por regra própria.';
  end;
end$$;


-- ── 6. Lead inexistente não vira negócio ───────────────────────────────────
do $$
declare v_deal uuid;
begin
  begin
    v_deal := public.abrir_negocio(
      p_lead_id => '00000000-0000-4000-8000-000000000000',
      p_pipe    => 'whatsapp',
      p_stage   => 'novo'
    );
    raise exception 'FAIL(6): criou negócio para lead inexistente.';
  exception when no_data_found then
    raise notice 'OK(6): lead inexistente recusado.';
  end;
end$$;


-- ── 7. Título explícito sobrevive (decisão 9: derivado E editável) ─────────
do $$
declare v_deal uuid; v_title text;
begin
  v_deal := public.abrir_negocio(
    p_lead_id => 'aaaaaaaa-3333-4000-8000-000000000001',
    p_pipe    => 'confirmacao',
    p_stage   => 'marcada',
    p_title   => 'Reposição trimestral'
  );
  select title into v_title from public.deals where id = v_deal;
  if v_title <> 'Reposição trimestral' then
    raise exception 'FAIL(7): título explícito virou "%".', v_title;
  end if;
  raise notice 'OK(7): título explícito preservado.';
end$$;


-- ── 8. M6 no ar: escrita cross-org é recusada pelo BANCO ───────────────────
-- A prova 4 é a guarda da função. Esta é a do gatilho — a que vale mesmo quando
-- alguém escreve direto na tabela, fora de qualquer função.
do $$
begin
  begin
    update public.pipeline_entries
       set assigned_to = 'bbbbbbbb-1111-4000-8000-000000000002'
     where lead_id = 'aaaaaaaa-3333-4000-8000-000000000001';
    raise exception 'FAIL(8): o gatilho do M6 deixou passar responsável de outra org.';
  exception when others then
    if sqlerrm like '%FAIL(8)%' then raise; end if;
    raise notice 'OK(8): gatilho M6 recusou escrita direta cross-org.';
  end;
end$$;


-- ── Resumo ─────────────────────────────────────────────────────────────────
do $$
declare v_deals int; v_entries int; v_ligados int;
begin
  select count(*) into v_deals from public.deals;
  select count(*) into v_entries from public.pipeline_entries;
  select count(*) into v_ligados from public.pipeline_entries where deal_id is not null;
  raise notice 'RESUMO: % negócio(s), % card(s), % ligado(s) por deal_id.', v_deals, v_entries, v_ligados;
  if v_entries <> v_ligados then
    raise exception 'FAIL: % card(s) ficaram sem deal_id — a porta deixou órfão.', v_entries - v_ligados;
  end if;
end$$;
