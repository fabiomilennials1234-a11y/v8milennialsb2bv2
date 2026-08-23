-- ============================================================================
-- Prova de comportamento da `20270803000040`: mover o Negócio para FORA do funil
-- WhatsApp esvazia `leads.pipe_whatsapp`, em vez de congelá-la.
--
-- Vive aqui, e não na migration, por causa da guarda F4: provar isso exige criar
-- e mover dado, e migration é só schema. Aqui é branch efêmera, onde escrever é
-- de graça.
--
-- Roda DEPOIS de `fatia2-branch-seed.sql` (que já cria a org, os três funis de
-- sistema e as etapas).
--
-- O caso não é hipotético: medido em prod 2026-08-03, **81 organizações** têm
-- `whatsapp/agendado → confirmacao/reuniao_marcada` configurado em
-- `pipeline_stages`, e outras ~26 têm `whatsapp/proposta_enviada → propostas`.
-- Sair do funil WhatsApp é o caminho normal de mais de 100 orgs.
-- ============================================================================

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

insert into public.leads (id, organization_id, name, phone, pipe_whatsapp)
values ('aaaaaaaa-3333-4000-8000-00000000000e', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Lead que Sai do WhatsApp', '5511900000002', null)
on conflict (id) do nothing;

insert into public.pipeline_entries
  (id, pipeline_id, lead_id, organization_id, stage_key)
values ('aaaaaaaa-4444-4000-8000-00000000000e', 'aaaaaaaa-2222-4000-8000-000000000001',
        'aaaaaaaa-3333-4000-8000-00000000000e', 'aaaaaaaa-0000-4000-8000-000000000001',
        'abordado')
on conflict (id) do nothing;

-- ── 1. Entrar no funil escreve o espelho (comportamento antigo, preservado) ──
do $$
declare v_col text;
begin
  select pipe_whatsapp into v_col from public.leads
   where id = 'aaaaaaaa-3333-4000-8000-00000000000e';
  if v_col is distinct from 'abordado' then
    raise exception 'FAIL(1): entrar no funil WhatsApp devia espelhar "abordado", veio "%".', v_col;
  end if;
  raise notice 'OK(1): entrar no funil escreve o espelho — comportamento antigo intacto.';
end$$;

-- ── 2. Andar DENTRO do funil atualiza o espelho ────────────────────────────
do $$
declare v_col text;
begin
  update public.pipeline_entries set stage_key = 'agendado'
   where id = 'aaaaaaaa-4444-4000-8000-00000000000e';

  select pipe_whatsapp into v_col from public.leads
   where id = 'aaaaaaaa-3333-4000-8000-00000000000e';
  if v_col is distinct from 'agendado' then
    raise exception 'FAIL(2): andar dentro do funil devia espelhar "agendado", veio "%".', v_col;
  end if;
  raise notice 'OK(2): andar dentro do funil atualiza o espelho.';
end$$;

-- ── 3. O CONSERTO — SAIR do funil esvazia, em vez de congelar ──────────────
do $$
declare v_col text; v_cards int;
begin
  -- O move da decisão 4: a MESMA linha troca de funil e de etapa.
  update public.pipeline_entries
     set pipeline_id = 'aaaaaaaa-2222-4000-8000-000000000002',  -- Oportunidades
         stage_key   = 'marcada'
   where id = 'aaaaaaaa-4444-4000-8000-00000000000e';

  select pipe_whatsapp into v_col from public.leads
   where id = 'aaaaaaaa-3333-4000-8000-00000000000e';

  if v_col is not null then
    raise exception
      'FAIL(3): depois de sair do funil WhatsApp a coluna ficou "%" — congelada. Vazio degrada de boa; congelado faz {estagio} imprimir etapa velha e condicao de automacao casar sempre.', v_col;
  end if;

  -- E o move é MOVE: uma linha só, não duas.
  select count(*) into v_cards from public.pipeline_entries
   where lead_id = 'aaaaaaaa-3333-4000-8000-00000000000e';
  if v_cards <> 1 then
    raise exception 'FAIL(3): o lead ficou com % card(s) — mover devia manter UM.', v_cards;
  end if;

  raise notice 'OK(3): sair do funil ESVAZIA o espelho, e o card continua sendo um só.';
end$$;

-- ── 4. Voltar para o funil volta a espelhar ────────────────────────────────
-- Sem isto, um conserto que zerasse "sempre" passaria nos testes 1-3 e quebraria
-- o caminho de volta em silêncio.
do $$
declare v_col text;
begin
  update public.pipeline_entries
     set pipeline_id = 'aaaaaaaa-2222-4000-8000-000000000001',  -- Qualificação
         stage_key   = 'novo'
   where id = 'aaaaaaaa-4444-4000-8000-00000000000e';

  select pipe_whatsapp into v_col from public.leads
   where id = 'aaaaaaaa-3333-4000-8000-00000000000e';
  if v_col is distinct from 'novo' then
    raise exception 'FAIL(4): voltar ao funil devia espelhar "novo", veio "%".', v_col;
  end if;
  raise notice 'OK(4): voltar ao funil volta a espelhar — o conserto nao zera cegamente.';
end$$;

-- ── 5. DELETE continua esvaziando (o ramo que já existia) ──────────────────
do $$
declare v_col text;
begin
  delete from public.pipeline_entries where id = 'aaaaaaaa-4444-4000-8000-00000000000e';

  select pipe_whatsapp into v_col from public.leads
   where id = 'aaaaaaaa-3333-4000-8000-00000000000e';
  if v_col is not null then
    raise exception 'FAIL(5): DELETE devia esvaziar o espelho, ficou "%".', v_col;
  end if;
  raise notice 'OK(5): o ramo DELETE continua esvaziando — nada regrediu.';
end$$;
