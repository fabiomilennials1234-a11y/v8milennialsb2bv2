-- ============================================================================
-- A prova do passo 5b: mover produz A MESMA métrica de reunião que duplicar.
--
-- É um A/B no mesmo banco. Para cada caminho, dois leads gêmeos:
--   • um percorre o caminho DE HOJE (UPDATE na origem + INSERT no destino);
--   • outro percorre `mover_negocio`.
-- Depois compara `meeting_events`. Se divergir, o passo 5 quebra o número de
-- reunião no dia do deploy — que é exatamente o risco que este arquivo existe
-- para medir, e não para supor.
--
-- Roda DEPOIS de `fatia2-branch-seed.sql`.
--
-- Os dois caminhos somam 176 orgs em prod (medido 2026-08-03):
--   whatsapp/agendado → confirmacao ....... 81 orgs
--   confirmacao/compareceu → propostas .... 95 orgs
-- ============================================================================

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- Etapas que o caso A precisa e o seed base não traz.
insert into public.pipeline_stages (organization_id, pipeline_type, stage_key, name, position, is_active)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'whatsapp',    'agendado',        'Agendado',        2, true),
       ('aaaaaaaa-0000-4000-8000-000000000001', 'confirmacao', 'reuniao_marcada', 'Reunião Marcada', 2, true)
on conflict do nothing;

-- Quatro leads gêmeos.
insert into public.leads (id, organization_id, name, phone) values
  ('aaaaaaaa-5555-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'A-hoje',  '5511900001001'),
  ('aaaaaaaa-5555-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001', 'A-move',  '5511900001002'),
  ('aaaaaaaa-5555-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001', 'B-hoje',  '5511900001003'),
  ('aaaaaaaa-5555-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001', 'B-move',  '5511900001004')
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- CASO A — whatsapp/agendado → confirmacao/reuniao_marcada (81 orgs)
-- ════════════════════════════════════════════════════════════════════════════

-- A-hoje: o caminho atual. Card em Qualificação sobe para 'agendado', e um card
-- NOVO nasce em Oportunidades. O primeiro fica para trás — é o gêmeo.
insert into public.pipeline_entries (id, pipeline_id, lead_id, organization_id, stage_key)
values ('aaaaaaaa-6666-4000-8000-00000000000a', 'aaaaaaaa-2222-4000-8000-000000000001',
        'aaaaaaaa-5555-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'novo')
on conflict (id) do nothing;

update public.pipeline_entries set stage_key = 'agendado'
 where id = 'aaaaaaaa-6666-4000-8000-00000000000a';

insert into public.pipeline_entries (pipeline_id, lead_id, organization_id, stage_key)
values ('aaaaaaaa-2222-4000-8000-000000000002', 'aaaaaaaa-5555-4000-8000-00000000000a',
        'aaaaaaaa-0000-4000-8000-000000000001', 'reuniao_marcada');

-- A-move: mesma jornada, uma linha só.
insert into public.pipeline_entries (id, pipeline_id, lead_id, organization_id, stage_key)
values ('aaaaaaaa-6666-4000-8000-00000000000b', 'aaaaaaaa-2222-4000-8000-000000000001',
        'aaaaaaaa-5555-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001', 'novo')
on conflict (id) do nothing;

select public.mover_negocio(
  p_entry_id           => 'aaaaaaaa-6666-4000-8000-00000000000b',
  p_target_pipeline_id => 'aaaaaaaa-2222-4000-8000-000000000002',
  p_target_stage_key   => 'reuniao_marcada',
  p_stage_origem       => 'agendado'
);

do $$
declare v_hoje_ev int; v_move_ev int; v_hoje_cards int; v_move_cards int;
begin
  select count(*) into v_hoje_ev from public.meeting_events
   where lead_id = 'aaaaaaaa-5555-4000-8000-00000000000a';
  select count(*) into v_move_ev from public.meeting_events
   where lead_id = 'aaaaaaaa-5555-4000-8000-00000000000b';
  select count(*) into v_hoje_cards from public.pipeline_entries
   where lead_id = 'aaaaaaaa-5555-4000-8000-00000000000a';
  select count(*) into v_move_cards from public.pipeline_entries
   where lead_id = 'aaaaaaaa-5555-4000-8000-00000000000b';

  if v_move_ev <> v_hoje_ev then
    raise exception
      'FAIL(A): duplicando gerou % evento(s) de reuniao, movendo gerou %. O passo 5 mudaria a metrica de 81 orgs.',
      v_hoje_ev, v_move_ev;
  end if;
  if v_hoje_ev = 0 then
    raise exception 'FAIL(A): o caminho de HOJE gerou 0 eventos — o cenario nao exercita a metrica, e a comparacao nao prova nada.';
  end if;
  if v_hoje_cards <> 2 then
    raise exception 'FAIL(A): o caminho de hoje devia deixar 2 cards (o gemeo), deixou %.', v_hoje_cards;
  end if;
  if v_move_cards <> 1 then
    raise exception 'FAIL(A): mover devia deixar 1 card, deixou % — nao moveu, copiou.', v_move_cards;
  end if;

  raise notice 'OK(A) whatsapp→confirmacao: % evento(s) nos dois caminhos; hoje deixa % cards, mover deixa %.',
    v_hoje_ev, v_hoje_cards, v_move_cards;
end$$;


-- ════════════════════════════════════════════════════════════════════════════
-- CASO B — confirmacao/compareceu → propostas/marcar_compromisso (95 orgs)
-- ════════════════════════════════════════════════════════════════════════════

-- Os dois começam já com reunião marcada, senão `meeting_held` não tem o que
-- casar e o cenário mede menos do que deveria.
insert into public.pipeline_entries (id, pipeline_id, lead_id, organization_id, stage_key)
values ('aaaaaaaa-6666-4000-8000-00000000000c', 'aaaaaaaa-2222-4000-8000-000000000002',
        'aaaaaaaa-5555-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001', 'marcada'),
       ('aaaaaaaa-6666-4000-8000-00000000000d', 'aaaaaaaa-2222-4000-8000-000000000002',
        'aaaaaaaa-5555-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001', 'marcada')
on conflict (id) do nothing;

-- B-hoje: origem sobe para 'compareceu', card novo nasce em Orçamentos.
update public.pipeline_entries set stage_key = 'compareceu'
 where id = 'aaaaaaaa-6666-4000-8000-00000000000c';

insert into public.pipeline_entries (pipeline_id, lead_id, organization_id, stage_key)
values ('aaaaaaaa-2222-4000-8000-000000000003', 'aaaaaaaa-5555-4000-8000-00000000000c',
        'aaaaaaaa-0000-4000-8000-000000000001', 'enviada');

-- B-move: passa por 'compareceu' e sai, na mesma linha.
select public.mover_negocio(
  p_entry_id           => 'aaaaaaaa-6666-4000-8000-00000000000d',
  p_target_pipeline_id => 'aaaaaaaa-2222-4000-8000-000000000003',
  p_target_stage_key   => 'enviada',
  p_stage_origem       => 'compareceu'
);

do $$
declare
  v_hoje_ev int; v_move_ev int; v_hoje_held int; v_move_held int;
  v_hoje_cards int; v_move_cards int;
begin
  select count(*), count(*) filter (where event_type = 'meeting_held')
    into v_hoje_ev, v_hoje_held
    from public.meeting_events where lead_id = 'aaaaaaaa-5555-4000-8000-00000000000c';
  select count(*), count(*) filter (where event_type = 'meeting_held')
    into v_move_ev, v_move_held
    from public.meeting_events where lead_id = 'aaaaaaaa-5555-4000-8000-00000000000d';
  select count(*) into v_hoje_cards from public.pipeline_entries
   where lead_id = 'aaaaaaaa-5555-4000-8000-00000000000c';
  select count(*) into v_move_cards from public.pipeline_entries
   where lead_id = 'aaaaaaaa-5555-4000-8000-00000000000d';

  if v_move_ev <> v_hoje_ev or v_move_held <> v_hoje_held then
    raise exception
      'FAIL(B): duplicando gerou % evento(s) (% held), movendo gerou % (% held). O passo 5 mudaria a metrica de 95 orgs.',
      v_hoje_ev, v_hoje_held, v_move_ev, v_move_held;
  end if;
  if v_hoje_held = 0 then
    raise exception 'FAIL(B): o caminho de HOJE nao gerou meeting_held — o cenario nao exercita a metrica.';
  end if;
  if v_hoje_cards <> 2 then
    raise exception 'FAIL(B): o caminho de hoje devia deixar 2 cards, deixou %.', v_hoje_cards;
  end if;
  if v_move_cards <> 1 then
    raise exception 'FAIL(B): mover devia deixar 1 card, deixou %.', v_move_cards;
  end if;

  raise notice 'OK(B) confirmacao→propostas: % evento(s) (% held) nos dois caminhos; hoje deixa % cards, mover deixa %.',
    v_hoje_ev, v_hoje_held, v_hoje_cards, v_move_cards;
end$$;


-- ── C. A recusa do destino custom (passo 5c) ───────────────────────────────
-- Recusar explicitamente vale mais que resolver errado: atravessar para funil
-- custom perde o id do card, e isso é decisão de modelo, não de código.
do $$
declare v_pipe_custom uuid; v_r uuid;
begin
  insert into public.pipelines (organization_id, name, slug, type)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'Funil Custom Teste', 'custom-teste', 'custom')
  returning id into v_pipe_custom;

  begin
    v_r := public.mover_negocio(
      p_entry_id           => 'aaaaaaaa-6666-4000-8000-00000000000d',
      p_target_pipeline_id => v_pipe_custom,
      p_target_stage_key   => 'novo'
    );
    raise exception 'FAIL(C): aceitou destino custom — o card atravessaria de tabela e perderia o id.';
  exception when feature_not_supported then
    raise notice 'OK(C): destino custom recusado — passo 5c segue sendo decisao, nao gambiarra.';
  end;

  delete from public.pipelines where id = v_pipe_custom;
end$$;


-- ── D. O espelho pipe_whatsapp acompanhou o move (passo 5a) ────────────────
do $$
declare v_col text;
begin
  select pipe_whatsapp into v_col from public.leads
   where id = 'aaaaaaaa-5555-4000-8000-00000000000b';
  if v_col is not null then
    raise exception 'FAIL(D): o lead A-move saiu do funil WhatsApp e a coluna ficou "%" — congelada.', v_col;
  end if;
  raise notice 'OK(D): o move esvaziou leads.pipe_whatsapp do lead que saiu do funil.';
end$$;
