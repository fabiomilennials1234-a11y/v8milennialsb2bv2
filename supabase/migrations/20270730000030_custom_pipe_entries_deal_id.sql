-- ============================================================================
-- Fatia 2 — separação Lead ↔ Negócio | Decisão F do CTO
-- `custom_pipe_entries.deal_id` + a propagação que o conserto ingênuo esquece.
--
-- ── POR QUE ────────────────────────────────────────────────────────────────
-- `pipeline_entries` já ganhou `deal_id` (FK + índice parcial). Seu par custom,
-- `custom_pipe_entries`, não — e são 16.177 cards em 24 orgs (medido em prod
-- 2026-07-30). Sem a coluna, todo funil custom fica de fora do modelo de
-- Negócio.
--
-- ── A JUSTIFICATIVA ORIGINAL ESTAVA ERRADA, E O CONSERTO ÓBVIO DEIXA BURACO ──
-- A leitura inicial era "custom_pipe_entries é uma tabela paralela, basta
-- adicionar a coluna". Errado nos dois pontos que importam:
--
--   1. Não é paralela: `sync_custom_pipe_to_entries()` espelha
--      custom_pipe_entries → pipeline_entries com a MESMA primary key
--      (`INSERT (id, ...) VALUES (NEW.id, ...) ON CONFLICT (id) DO UPDATE`).
--      Medido em prod: 16.177 de 16.177 linhas têm par de `id` do outro lado,
--      e 0 divergem de organization_id. É espelho 1:1, não tabela irmã.
--
--   2. O `ON CONFLICT ... DO UPDATE` desse sync NÃO menciona deal_id, e não
--      existe trigger reverso. Então o backfill (M4), que popula
--      `pipeline_entries.deal_id`, deixaria o espelho custom com deal_id NULL
--      **para sempre** — e o kanban custom lê `custom_pipe_entries`, não
--      `pipeline_entries` (src/modules/pipelines/hooks/custom/useCustomPipelines.ts).
--      Ou seja: adicionar só a coluna produz uma coluna que nasce e morre NULL.
--
-- ── DECISÃO: (c) — as duas pontas ──────────────────────────────────────────
-- (a) `deal_id` entra no sync (INSERT + DO UPDATE): torna custom_pipe_entries a
--     fonte autoritativa do card custom, como já é para stage/assigned/notes.
--     Sozinho não resolve — o dado do M4 chega pelo OUTRO lado.
-- (b) trigger reverso pipeline_entries → custom_pipe_entries só para deal_id:
--     é o que faz a escrita do M4 (e a de qualquer caminho legado que ainda
--     enxergue só `pipeline_entries`) descer até a fonte.
-- Uma sem a outra deixa metade do buraco aberto: (a) sem (b) não recebe o
-- backfill; (b) sem (a) faz o próximo arrastar-e-soltar do card apagar o
-- deal_id do espelho, porque o sync reescreveria a linha sem o campo.
--
-- ── POR QUE NÃO HÁ LAÇO INFINITO (a prova, não a promessa) ──────────────────
-- Os dois triggers escrevem um no outro, então a terminação precisa ser
-- demonstrada, não assumida. São DUAS guardas independentes, ambas por VALOR:
--
--   G1. `WHEN (OLD.deal_id IS DISTINCT FROM NEW.deal_id)` no trigger reverso.
--   G2. `AND deal_id IS DISTINCT FROM NEW.deal_id` no WHERE do UPDATE que ele
--       executa — se nada muda, 0 linhas afetadas e nenhum trigger dispara.
--
-- Trace partindo do espelho (caminho do M4):
--   1. UPDATE pipeline_entries SET deal_id = D (era NULL) → G1 verdadeira, dispara.
--   2. UPDATE custom_pipe_entries SET deal_id = D → dispara o sync.
--   3. Sync reescreve pipeline_entries com deal_id = D, que JÁ é D.
--      A cláusula `UPDATE OF deal_id` do trigger reverso é satisfeita (a coluna
--      é mencionada no SET), mas G1 é falsa (D IS NOT DISTINCT FROM D). PARA.
--
-- Trace partindo da fonte (caminho do usuário movendo o card):
--   1. UPDATE custom_pipe_entries SET deal_id = D → sync escreve pipeline_entries.
--   2. deal_id mudou lá → G1 verdadeira, trigger reverso dispara.
--   3. UPDATE ... WHERE deal_id IS DISTINCT FROM D → custom já está D → 0 linhas. PARA.
--
-- Profundidade máxima 3, convergente por construção. Deliberadamente NÃO uso
-- `pg_trigger_depth()` como trava: profundidade é proxy, não invariante — um
-- teto por profundidade descartaria SILENCIOSAMENTE uma propagação legítima que
-- nascesse dentro de outro trigger (exatamente o que o M4 pode fazer). Guarda
-- por valor converge para o estado certo em vez de abortar no meio dele.
--
-- ── O CASCATEAMENTO É INÓCUO — MAS SÓ PARA ESCRITA ISOLADA DE deal_id ───────
-- O passo 3 do trace faz o sync reescrever `pipeline_entries` mencionando
-- `stage_key`, o que satisfaz a lista de colunas de vários triggers. `pipeline_entries`
-- tem HOJE 13 triggers não-internos; 11 deles estão no caminho de UPDATE que o
-- sync percorre — não três, como dizia a versão anterior deste cabeçalho, que
-- listava só os que barram por dentro e omitia justamente os que mutam. Os 11
-- foram lidos no catálogo, um a um; todos são inertes ENQUANTO o statement de
-- origem mexer só em deal_id:
--   • update_pipeline_entries_updated_at (BEFORE UPDATE, sem lista de colunas,
--     sem WHEN) → `update_updated_at()` carimba updated_at = now(). NÃO é inerte:
--     é o efeito colateral assumido, tratado no bloco abaixo.
--   • trg_pipeline_entry_stage_changed (BEFORE UPDATE, sem lista de colunas)
--     → `set_pipeline_entry_stage_changed()` guarda em stage_key DISTINCT: no-op.
--   • trg_pipeline_entries_stage_changed_at (BEFORE UPDATE, WHEN stage_key
--     DISTINCT) → nem chega a disparar.
--   • trg_enforce_closed_at (BEFORE INSERT OR UPDATE OF stage_key) → dispara e
--     MUTA `closed_at` se stage_key for 'vendido'/'perdido' com closed_at NULL.
--     Medido em prod 2026-07-30: 0 cards custom nesse estado. Inerte por dado,
--     não por desenho — se um funil custom passar a usar essas chaves, muda.
--   • trg_pipeline_entries_dispatch (AFTER INSERT OR UPDATE OF stage_key)
--     → `trigger_pipeline_entries_dispatch()` resolve slug só de pipeline
--     `type='system'`; funil custom devolve NULL e sai antes. Ainda exige
--     stage_key DISTINCT.
--   • trg_apply_stage_checklist_pipeline (AFTER INSERT OR UPDATE OF stage_key)
--     → `apply_stage_checklist()` early-return se stage_key não mudou.
--   • trg_meeting_events_capture (AFTER INSERT OR UPDATE OF stage_key, metadata)
--     → `fn_capture_meeting_event()`: os três ramos (booked/reschedule/held)
--     exigem stage_key DISTINCT ou metadata->>'meeting_date' DISTINCT; o sync não
--     toca metadata no DO UPDATE. Custa 4 SELECTs por linha antes de sair — é
--     custo, não efeito.
--   • trg_sync_whatsapp_stage_to_lead (AFTER INSERT/DELETE/UPDATE, sem lista de
--     colunas) → é o ÚNICO do conjunto que ESCREVE EM OUTRA TABELA (`leads`), e
--     a proteção dele é de natureza diferente das outras: `pg_trigger_depth() > 1`.
--     Como o sync sempre roda aninhado (depth ≥ 2), ele sai na primeira linha.
--     Fora do aninhamento ainda exigiria pipeline `type='system'` slug 'whatsapp'.
--   • trg_pipeline_entries_stage_event_update, trg_log_pipeline_stage_change_history
--     e trg_workflow_pipeline_stage_changed têm WHEN por stage_key DISTINCT: não
--     chegam a disparar aqui. (Ver o invariante abaixo — na escrita COMBINADA os
--     três disparam, e dois deles gravam.)
-- Fora do caminho de UPDATE, e por isso fora da conta: trg_pe_snapshot_responsibles
-- e trg_pipeline_entries_stage_event_insert, ambos AFTER/BEFORE INSERT.
-- Do lado custom, `trigger_workflow_custom_pipe_stage_change` (AFTER UPDATE sem
-- lista de colunas) guarda em `OLD.stage_id IS DISTINCT FROM NEW.stage_id`:
-- escrita só de deal_id NÃO enfileira workflow. Isso importa muito — é a mesma
-- classe do incidente em que mexer em custom_pipe_entries furou filtro de
-- workflow e quase virou disparo em massa.
-- Conclusão, com o escopo explícito: numa escrita ISOLADA de deal_id, nenhum
-- envio, nenhum meeting_event, nenhum checklist, nenhum workflow nasce daqui.
--
-- ⚠️ INVARIANTE NOVO — ESCRITA COMBINADA EM CARD CUSTOM NÃO É SEGURA ─────────
-- A inocuidade acima vale para `SET deal_id = ...` e nada mais. O trigger do
-- passo 5 é `AFTER UPDATE OF deal_id`, e essa cláusula também é satisfeita
-- quando deal_id viaja junto de outras colunas no MESMO SET:
--   UPDATE pipeline_entries SET deal_id = D, stage_key = 'proposta' WHERE id = X
-- com X sendo card custom. O bounce (reverso → custom → sync) reescreve
-- `stage_key = EXCLUDED.stage_key` com o valor da FONTE e reverte em silêncio a
-- escrita do chamador — a fonte SEMPRE vence o bounce. E como stage_key mudou
-- de verdade nessa reversão, os triggers acima deixam de ser inertes:
--   • trg_pipeline_entries_stage_event_update → `fn_capture_pipeline_stage_event`
--     não tem guarda nenhuma: grava linha espúria em `pipeline_stage_events`, o
--     caderno do ADR-0017.
--   • trg_log_pipeline_stage_change_history → `fn_log_pipeline_stage_change_history`
--     sai cedo quando auth.uid() IS NOT NULL; em contexto de automação /
--     service_role (exatamente o M4) grava em `lead_history` um movimento
--     invertido que nunca aconteceu.
--   • trg_meeting_events_capture → o ramo booked casa em `stage_key = 'agendado'`
--     e o held em 'compareceu'. Medido em prod: 28 cards custom parados em
--     'agendado' e 5 em 'compareceu' — escrita combinada neles pode PARIR
--     meeting_event.
-- Não acordam nem assim: dispatch e workflow (ambos resolvem slug com
-- `pip.type = 'system'` → NULL em funil custom).
-- ⇒ REGRA que passa a valer depois desta migration: para card custom, escreva a
--   FONTE (`custom_pipe_entries`), ou escreva `deal_id` SOZINHO no statement.
--   Nunca deal_id junto de stage_key/assigned_to/notes/stage_changed_at em
--   `pipeline_entries`.
-- Considerado e RECUSADO nesta fatia: pôr `WHERE` no `ON CONFLICT DO UPDATE` do
-- sync para cortar o bounce quando nada muda. Resolveria mecanicamente, mas muda
-- comportamento observável de uma função compartilhada — deixa de refrescar
-- `pipeline_entries.updated_at` e de emitir evento Realtime no espelho quando o
-- DO UPDATE vira no-op — e a segurança desta fatia inteira se apoia em "corpo
-- VERBATIM + exatamente três acréscimos". Nenhum consumidor desses dois efeitos
-- foi enumerado. Vale slice própria, não carona nesta.
--
-- ⚠️ EFEITO COLATERAL REAL, ASSUMIDO: NENHUMA ROTA PRESERVA `updated_at` ─────
-- A causa NÃO é o trigger reverso — ele nunca foi a causa. São dois triggers de
-- carimbo, um em cada tabela, ambos BEFORE UPDATE FOR EACH ROW, ambos SEM lista
-- de colunas e SEM WHEN (verificado no catálogo, prod e branch de QA):
--   • custom_pipe_entries → trg_custom_pipe_entries_updated_at
--       → `update_updated_at_column()`: `NEW.updated_at = NOW()`, incondicional.
--   • pipeline_entries    → update_pipeline_entries_updated_at
--       → `update_updated_at()`:        `NEW.updated_at = now()`, incondicional.
-- Consequência, rota por rota, para os 16.177 cards:
--   • Backfill pela FONTE (`UPDATE custom_pipe_entries SET deal_id`): carimba a
--     fonte no BEFORE dela; o sync escreve o espelho e o BEFORE do espelho
--     carimba o espelho também (por cima do `updated_at = EXCLUDED.updated_at`).
--     DUAS tabelas carimbadas.
--   • Backfill pelo ESPELHO (`UPDATE pipeline_entries SET deal_id`): carimba o
--     espelho; o trigger reverso escreve a fonte (carimba a fonte); o sync
--     bounce carimba o espelho de novo. DUAS tabelas carimbadas.
-- Ou seja: a rota "pela fonte" NÃO compra nada nesse quesito. A versão anterior
-- deste cabeçalho a recomendava alegando que ela "dispara ZERO vezes o trigger
-- reverso" e que por isso preservaria updated_at. As duas metades são falsas: o
-- trigger reverso DISPARA nessa rota (o próprio trace acima, "partindo da fonte",
-- passo 2 — ele só não afeta linha nenhuma, por G2), e o carimbo nunca dependeu
-- dele. Escolha a rota por outro critério (a da fonte tem metade do encadeamento
-- e é a mais simples de auditar), não por updated_at.
-- ⇒ SE preservar updated_at importar, a saída é mecânica e é o M4 quem paga:
--     ALTER TABLE public.custom_pipe_entries DISABLE TRIGGER trg_custom_pipe_entries_updated_at;
--     ALTER TABLE public.pipeline_entries    DISABLE TRIGGER update_pipeline_entries_updated_at;
--   em volta do backfill (exige ownership, pega ACCESS EXCLUSIVE e, enquanto
--   desabilitados, NENHUMA escrita concorrente carimba), ou snapshot/restore de
--   updated_at das duas tabelas. Não existe rota "de graça".
--
-- ⚠️ `stage_changed_at` É REESCRITO — a versão anterior deste cabeçalho afirmava
-- que ele "não é tocado em nenhum dos caminhos". É falso: ele está no
-- `ON CONFLICT (id) DO UPDATE` do passo 4, logo abaixo neste mesmo arquivo, entre
-- `notes` e `updated_at`: `stage_changed_at = EXCLUDED.stage_changed_at`. Todo
-- bounce sobrescreve
-- `pipeline_entries.stage_changed_at` com o valor da FONTE, e as duas rotas de
-- backfill terminam no sync — não há rota que escape dele. Medido em prod
-- 2026-07-30: 367 dos 16.177 pares JÁ divergem hoje, em 12 orgs, delta máximo de
-- 28 dias, nenhum envolvendo NULL. Um backfill reconcilia esses 367 à força.
-- Quem lê a coluna do lado do espelho: `useLeadsDeals`
-- (src/modules/leads/hooks/useLeadsDeals.ts:105 e :175) consulta
-- `pipeline_entries` sem filtrar tipo de funil, então a "idade na etapa" da aba
-- Negócios muda para esses 367. O filtro "Parado há" da migration irmã
-- (20270729000010:146-147) lê a mesma coluna, mas o RPC dele resolve só
-- `p.type='system'` (linha 96 daquele arquivo), então card custom nunca chega
-- lá — esse filtro NÃO é afetado.
-- ⇒ M4: ou assume os 367 como mutação declarada do backfill, ou snapshota
--   `pipeline_entries.stage_changed_at` antes e restaura depois. O kanban custom
--   lê a FONTE (`custom_pipe_entries`), que nenhuma das rotas altera.
--
-- ── ORDEM DE APLICAÇÃO (pré-condição verificada abaixo) ────────────────────
-- Esta migration precisa rodar ANTES do backfill M4. Dois motivos:
--   • plpgsql é late-bound: `CREATE OR REPLACE` do sync NÃO valida se
--     `pipeline_entries.deal_id` existe. Se a migration que criou aquela coluna
--     não tiver rodado, esta aqui passa e a função só explode no primeiro
--     arrastar-e-soltar de um card custom, em produção. Por isso o passo 0
--     aborta na cara se a coluna não estiver lá.
--   • se o M4 rodar antes, o espelho fica com deal_id e a fonte com NULL — o
--     buraco exato que esta migration existe para fechar. O passo 1b detecta
--     esse estado e aborta pedindo reconciliação explícita.
--
-- ── ROLLBACK (A ORDEM IMPORTA — É A ARMADILHA DE LATE-BINDING DE NOVO) ─────
-- Reversível sem perda enquanto `deals` não tiver dado vinculado. A REINSTALAÇÃO
-- DO SYNC VEM PRIMEIRO, e tudo numa transação só: se `sync_custom_pipe_to_entries()`
-- ainda mencionar `deal_id` depois do DROP COLUMN, todo arrastar-e-soltar de card
-- custom quebra em produção com `record "new" has no field "deal_id"` — exatamente
-- o modo de falha que o passo 0 existe para pegar, só que agora causado pelo
-- rollback. A receita anterior deste cabeçalho estava na ordem errada.
--   BEGIN;
--   -- 1º: reinstalar sync_custom_pipe_to_entries() SEM deal_id (versão anterior;
--   --     capture o corpo com pg_get_functiondef ANTES de aplicar esta migration).
--   DROP TRIGGER IF EXISTS trg_sync_deal_id_to_custom_pipe_entry ON public.pipeline_entries;
--   DROP FUNCTION IF EXISTS public.fn_sync_deal_id_to_custom_pipe_entry();
--   DROP INDEX IF EXISTS public.idx_custom_pipe_entries_deal;
--   ALTER TABLE public.custom_pipe_entries DROP CONSTRAINT IF EXISTS custom_pipe_entries_deal_id_fkey;
--   ALTER TABLE public.custom_pipe_entries DROP COLUMN IF EXISTS deal_id;
--   COMMIT;
-- Se já houver vínculo gravado, o DROP COLUMN é perda de dado: exportar antes
-- (`SELECT id, deal_id FROM custom_pipe_entries WHERE deal_id IS NOT NULL`).
-- Derrubar só o trigger reverso é seguro e não perde nada — degrada para "o
-- espelho não desce mais para a fonte".
--
-- ── ESCOPO ─────────────────────────────────────────────────────────────────
-- Só schema: nenhuma linha de cliente é escrita, apagada ou movida — não há
-- backfill aqui (guarda F4). A única leitura de dado de cliente é o COUNT de
-- pré-condição do passo 1b, que só sabe abortar a transação.
--
-- HERDADO (não é desta branch, não corrigido aqui): nem `pipeline_entries` nem
-- `custom_pipe_entries` têm FK composta garantindo que
-- `deals.organization_id` = `<entry>.organization_id`. A FK simples permite,
-- em tese, apontar para negócio de outro tenant. Vale issue própria.
-- ============================================================================

-- ── 0. Pré-condição — falhar aqui é barato, falhar em produção não ─────────
DO $$
DECLARE
  v_tem_coluna_espelho boolean;
BEGIN
  -- 0a. `pipeline_entries.deal_id` precisa existir ANTES: o corpo plpgsql do
  -- sync referencia essa coluna e o Postgres não resolve nomes de coluna na
  -- criação da função — só na primeira execução, em runtime, com o usuário na
  -- frente. Falhar agora transforma um bug de produção em erro de migration.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'pipeline_entries'
      AND column_name  = 'deal_id'
  ) INTO v_tem_coluna_espelho;

  IF NOT v_tem_coluna_espelho THEN
    RAISE EXCEPTION
      'FAIL: pipeline_entries.deal_id não existe. Esta migration depende dela '
      '(o sync passa a escrever nessa coluna). Aplique a migration que cria '
      'pipeline_entries.deal_id antes desta.';
  END IF;

  RAISE NOTICE 'Pré-condição OK: pipeline_entries.deal_id presente.';
END$$;

-- ── 1. Coluna ───────────────────────────────────────────────────────────────
-- Nullable e sem DEFAULT de propósito: ADD COLUMN assim é operação de catálogo,
-- não reescreve a tabela e não segura lock longo. `deal_id` NULL = card ainda
-- não promovido a Negócio, que é o estado de 100% das 16.177 linhas hoje.
ALTER TABLE public.custom_pipe_entries
  ADD COLUMN IF NOT EXISTS deal_id uuid;

COMMENT ON COLUMN public.custom_pipe_entries.deal_id IS
  'Negócio (deals) vinculado a este card de funil custom. NULL = card ainda não '
  'virou Negócio. Espelhado em pipeline_entries.deal_id por '
  'sync_custom_pipe_to_entries(); escritas que cheguem pelo espelho descem de '
  'volta por fn_sync_deal_id_to_custom_pipe_entry().';

-- ── 1b. O espelho não pode já estar na frente da fonte ─────────────────────
-- Roda só DEPOIS do ADD COLUMN, e não junto do passo 0, por um motivo concreto:
-- plpgsql resolve nomes de coluna na execução, então referenciar `c.deal_id`
-- antes de criá-la abortaria com "column does not exist" — erro verdadeiro,
-- mensagem inútil. Como tudo isto é uma transação só, falhar aqui desfaz o
-- ADD COLUMN igual: nada de meia-migration.
--
-- Se houver linha com deal_id em pipeline_entries cujo par custom está NULL,
-- alguém (M4) rodou fora de ordem. Aí o sync (a) que estamos instalando passaria
-- a propagar o NULL da fonte por cima do valor bom do espelho no próximo
-- movimento de card — perda silenciosa de vínculo. Abortar e reconciliar é a
-- única saída segura.
DO $$
DECLARE
  v_divergentes bigint;
BEGIN
  SELECT count(*) INTO v_divergentes
  FROM public.custom_pipe_entries c
  JOIN public.pipeline_entries    pe ON pe.id = c.id
  WHERE pe.deal_id IS NOT NULL
    AND c.deal_id IS NULL;

  IF v_divergentes > 0 THEN
    RAISE EXCEPTION
      'FAIL: % card(s) custom com deal_id no espelho (pipeline_entries) e NULL na fonte (custom_pipe_entries) — backfill rodou fora de ordem. '
      'Reconcilie antes: UPDATE public.custom_pipe_entries c SET deal_id = pe.deal_id FROM public.pipeline_entries pe '
      'WHERE pe.id = c.id AND pe.deal_id IS NOT NULL AND c.deal_id IS DISTINCT FROM pe.deal_id;', v_divergentes;
  END IF;

  RAISE NOTICE 'Fonte e espelho coerentes: 0 divergências de deal_id.';
END$$;

-- ── 2. FK — idêntica à de pipeline_entries ─────────────────────────────────
-- `ON DELETE SET NULL` espelha `pipeline_entries_deal_id_fkey` (confdeltype='n'):
-- apagar um Negócio desvincula o card, nunca apaga o card. CASCADE aqui seria
-- destruir histórico de funil por causa de um negócio removido.
-- Guardado por catálogo porque `ADD COLUMN IF NOT EXISTS` não adiciona a FK
-- quando a coluna já existe — sem esta guarda, um replay parcial ficaria com
-- coluna sem FK e a verificação final acusaria.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname   = 'custom_pipe_entries_deal_id_fkey'
      AND conrelid  = 'public.custom_pipe_entries'::regclass
  ) THEN
    ALTER TABLE public.custom_pipe_entries
      ADD CONSTRAINT custom_pipe_entries_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ── 3. Índice parcial — espelho fiel de idx_pipeline_entries_deal ──────────
-- Parcial em `deal_id IS NOT NULL` porque o padrão de acesso é "dado um
-- Negócio, ache os cards" — linha sem vínculo nunca é procurada por essa chave,
-- e hoje isso é 100% da tabela: o índice nasce vazio.
-- Sem CONCURRENTLY de propósito: migration roda em transação e CREATE INDEX
-- CONCURRENTLY não pode rodar dentro de uma. Não é problema — o índice parcial
-- é vazio na criação, então o lock é instantâneo.
CREATE INDEX IF NOT EXISTS idx_custom_pipe_entries_deal
  ON public.custom_pipe_entries USING btree (deal_id)
  WHERE deal_id IS NOT NULL;

-- ── 4. (a) O sync passa a carregar deal_id ─────────────────────────────────
-- Corpo reproduzido VERBATIM da versão em produção, com exatamente três
-- acréscimos: `deal_id` na lista de colunas, `NEW.deal_id` no VALUES e
-- `deal_id = EXCLUDED.deal_id` no DO UPDATE. Qualquer outra diferença aqui
-- seria mudança de comportamento fora do escopo desta fatia.
--
-- Por que `EXCLUDED.deal_id` puro e não `COALESCE(EXCLUDED.deal_id, <atual>)`:
-- COALESCE protegeria contra sobrescrever com NULL, mas ao custo de tornar o
-- DESvínculo impossível — limpar deal_id na fonte nunca chegaria ao espelho, e
-- os dois lados divergiriam em silêncio. A proteção contra o NULL indevido é
-- estrutural, não defensiva: o trigger reverso do passo 5 mantém a fonte sempre
-- em dia, e o passo 1b aborta se ela já estiver atrasada. Com a fonte correta,
-- propagar o valor dela é justamente o que se quer.
CREATE OR REPLACE FUNCTION public.sync_custom_pipe_to_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage_key TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.pipeline_entries WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  -- Resolve stage_key from custom_pipeline_stages
  SELECT stage_key INTO v_stage_key
  FROM public.custom_pipeline_stages
  WHERE id = NEW.stage_id;

  INSERT INTO public.pipeline_entries (
    id, organization_id, pipeline_id, lead_id, stage_key,
    assigned_to, notes, metadata,
    entered_at, stage_changed_at,
    created_at, updated_at,
    deal_id
  ) VALUES (
    NEW.id,
    NEW.organization_id,
    NEW.pipeline_id,
    NEW.lead_id,
    COALESCE(v_stage_key, 'unknown'),
    NEW.assigned_to,
    NEW.notes,
    '{}',
    NEW.entered_at,
    NEW.stage_changed_at,
    NEW.created_at,
    NEW.updated_at,
    NEW.deal_id
  )
  ON CONFLICT (id) DO UPDATE SET
    stage_key = EXCLUDED.stage_key,
    assigned_to = EXCLUDED.assigned_to,
    notes = EXCLUDED.notes,
    stage_changed_at = EXCLUDED.stage_changed_at,
    updated_at = EXCLUDED.updated_at,
    deal_id = EXCLUDED.deal_id;

  RETURN NEW;
END;
$function$;

-- ── 5. (b) Trigger reverso: espelho → fonte, só para deal_id ───────────────
CREATE OR REPLACE FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- SECURITY DEFINER pelo mesmo motivo de sync_custom_pipe_to_entries(): quem
  -- dispara isto é um usuário comum escrevendo em pipeline_entries, e a RLS de
  -- custom_pipe_entries poderia recusar a linha correspondente — o espelho
  -- ficaria calado e divergente. Roda como dono (bypassa RLS) e por isso é
  -- deliberadamente burro: nenhum SQL dinâmico, nenhum identificador vindo de
  -- fora, uma única linha alcançada por primary key.
  --
  -- `organization_id = NEW.organization_id` é defesa em profundidade multi-tenant:
  -- a linha custom tem, por construção do sync, o mesmo id E o mesmo org do
  -- espelho (medido em prod 2026-07-30: 0 divergências em 16.177 pares). A guarda
  -- fica, mas sem maquiar o preço: se algum dia divergir, o modo de falha NÃO é
  -- "espelho desatualizado". O UPDATE casa 0 linhas em silêncio, a fonte fica
  -- NULL com o espelho vinculado — o estado exato que o passo 1b aborta — e no
  -- PRÓXIMO movimento do card o sync propaga o NULL da fonte por cima do vínculo
  -- bom: perda silenciosa, não atraso. Escolho isso mesmo assim porque escrita
  -- cruzando tenant é pior que perda detectável, e o passo 1b é a rede na
  -- aplicação. Depois que a migration passa, nada monitora esse estado — issue
  -- própria, junto da FK composta org+deal citada no cabeçalho.
  -- Recusado de propósito um `RAISE WARNING` no caminho NOT FOUND: este trigger
  -- roda em TODA escrita de deal_id em pipeline_entries, e card de funil system
  -- (a maioria absoluta, e o grosso do M4) legitimamente não tem par custom —
  -- o aviso dispararia em volume de backfill e esconderia o caso raro em vez de
  -- revelá-lo. Sinal que grita sempre não é sinal.
  --
  -- `deal_id IS DISTINCT FROM NEW.deal_id` é a guarda G2 da prova de terminação
  -- no cabeçalho: quando o valor já está sincronizado, 0 linhas são afetadas e
  -- nenhum trigger encadeia. NÃO REMOVER — sem ela, este trigger e o sync se
  -- alimentam mutuamente até estourar a pilha.
  UPDATE public.custom_pipe_entries
     SET deal_id = NEW.deal_id
   WHERE id              = NEW.id
     AND organization_id = NEW.organization_id
     AND deal_id IS DISTINCT FROM NEW.deal_id;

  -- AFTER ... FOR EACH ROW: o retorno é ignorado pelo executor.
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry() IS
  'Desce pipeline_entries.deal_id para o card custom de mesmo id. Existe porque '
  'o sync custom→espelho é de mão única e o kanban custom lê custom_pipe_entries. '
  'Terminação garantida por dupla guarda IS DISTINCT FROM (ver cabeçalho da '
  'migration 20270730000030).';

DROP TRIGGER IF EXISTS trg_sync_deal_id_to_custom_pipe_entry ON public.pipeline_entries;

-- Só UPDATE, só a coluna deal_id, e ainda com WHEN por valor (guarda G1).
-- Não cobre INSERT de propósito: uma linha de pipeline_entries com id de card
-- custom só nasce pelo próprio sync, que já traz o deal_id da fonte (passo 4);
-- cobrir INSERT seria eco garantido do que acabou de vir de lá.
CREATE TRIGGER trg_sync_deal_id_to_custom_pipe_entry
  AFTER UPDATE OF deal_id ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.deal_id IS DISTINCT FROM NEW.deal_id)
  EXECUTE FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry();

-- ── 6. ACL ─────────────────────────────────────────────────────────────────
-- Função nova nasce com EXECUTE para PUBLIC (implícito) E para `anon`
-- nominalmente, porque este projeto concede via ALTER DEFAULT PRIVILEGES.
-- `REVOKE ... FROM PUBLIC` sozinho NÃO fecha o grant nominal — foi assim que
-- import_lead_into_custom_pipeline subiu executável por anon. Daí os dois.
--
-- `authenticated` mantém EXECUTE, espelhando sync_custom_pipe_to_entries()
-- (ACL medida em prod: {postgres=X, authenticated=X, service_role=X}). Não é
-- superfície de ataque: é função `RETURNS trigger`, e chamá-la direto devolve
-- "trigger functions can only be called as triggers". O privilégio de EXECUTE
-- não é consultado quando o trigger dispara — a checagem acontece no CREATE
-- TRIGGER —, então revogar de anon não quebra a propagação.
REVOKE ALL     ON FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry() TO authenticated, service_role;

-- Nada de GRANT de coluna: `custom_pipe_entries` tem grant em nível de TABELA
-- (`authenticated=arwdDxtm`), então `deal_id` já entra coberto. Se os grants
-- fossem por coluna, a coluna nova nasceria invisível para o kanban — foi
-- verificado no catálogo antes de escrever isto.

-- ── 7. Verificação — aborta a transação se qualquer peça faltar ────────────
DO $$
DECLARE
  v_ok        boolean;
  v_confdel   "char";
  v_def       text;
  v_sig       regprocedure;
BEGIN
  -- 7a. Coluna existe, uuid, nullable.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='custom_pipe_entries'
      AND column_name='deal_id' AND data_type='uuid' AND is_nullable='YES'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'FAIL: custom_pipe_entries.deal_id ausente ou com tipo/nulabilidade errados.';
  END IF;

  -- 7b. FK existe, aponta para deals(id) e é ON DELETE SET NULL ('n').
  SELECT c.confdeltype INTO v_confdel
  FROM pg_constraint c
  WHERE c.conname  = 'custom_pipe_entries_deal_id_fkey'
    AND c.conrelid = 'public.custom_pipe_entries'::regclass
    AND c.confrelid= 'public.deals'::regclass
    AND c.contype  = 'f';
  IF v_confdel IS NULL THEN
    RAISE EXCEPTION 'FAIL: FK custom_pipe_entries_deal_id_fkey → deals(id) não existe.';
  END IF;
  IF v_confdel <> 'n' THEN
    RAISE EXCEPTION 'FAIL: FK deal_id com ON DELETE % (esperava SET NULL) — apagar um Negócio apagaria cards.', v_confdel;
  END IF;

  -- 7c. Índice parcial existe com o predicado certo (espelho do lado system).
  SELECT indexdef INTO v_def FROM pg_indexes
  WHERE schemaname='public' AND tablename='custom_pipe_entries'
    AND indexname='idx_custom_pipe_entries_deal';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: idx_custom_pipe_entries_deal não existe.';
  END IF;
  IF v_def NOT ILIKE '%deal_id%' OR v_def NOT ILIKE '%IS NOT NULL%' THEN
    RAISE EXCEPTION 'FAIL: idx_custom_pipe_entries_deal não é parcial em deal_id IS NOT NULL: %', v_def;
  END IF;

  -- 7d. O sync realmente carrega deal_id nos dois caminhos (INSERT e UPDATE).
  -- Sem o DO UPDATE, mover um card apagaria o vínculo no espelho.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='sync_custom_pipe_to_entries';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: sync_custom_pipe_to_entries() sumiu.';
  END IF;
  IF v_def NOT LIKE '%NEW.deal_id%' THEN
    RAISE EXCEPTION 'FAIL: sync_custom_pipe_to_entries() não propaga deal_id no INSERT.';
  END IF;
  IF v_def NOT LIKE '%deal_id = EXCLUDED.deal_id%' THEN
    RAISE EXCEPTION 'FAIL: sync_custom_pipe_to_entries() não propaga deal_id no ON CONFLICT DO UPDATE — o vínculo morreria no primeiro movimento de card.';
  END IF;

  -- 7e. Trigger reverso existe COM a guarda G1. Um trigger sem WHEN aqui é
  -- recursão infinita, não uma imperfeição: falhar é o comportamento correto.
  SELECT pg_get_triggerdef(t.oid) INTO v_def
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.pipeline_entries'::regclass
    AND t.tgname  = 'trg_sync_deal_id_to_custom_pipe_entry'
    AND NOT t.tgisinternal;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: trigger trg_sync_deal_id_to_custom_pipe_entry não existe — backfill pelo espelho não desceria para o kanban custom.';
  END IF;
  IF v_def NOT ILIKE '%UPDATE OF deal_id%' THEN
    RAISE EXCEPTION 'FAIL: trigger reverso não está restrito a UPDATE OF deal_id: %', v_def;
  END IF;
  IF v_def NOT ILIKE '%WHEN%' OR v_def NOT ILIKE '%IS DISTINCT FROM%' THEN
    RAISE EXCEPTION 'FAIL: trigger reverso sem guarda WHEN ... IS DISTINCT FROM (G1) — LAÇO INFINITO com o sync. Abortando: %', v_def;
  END IF;

  -- 7f. Guarda G2 dentro da função. G1 sozinha já termina, mas as duas juntas
  -- são o que torna a terminação independente de como o trigger foi recriado.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='fn_sync_deal_id_to_custom_pipe_entry';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: fn_sync_deal_id_to_custom_pipe_entry() não existe.';
  END IF;
  -- Os padrões exigem o `AND ` na frente de propósito: as mesmas expressões
  -- aparecem citadas nos comentários da própria função, e sem essa âncora a
  -- verificação passaria só com o comentário, mesmo que alguém apagasse a
  -- cláusula WHERE de verdade. `AND <expr>` só existe no WHERE.
  IF v_def NOT LIKE '%AND deal_id IS DISTINCT FROM NEW.deal_id%' THEN
    RAISE EXCEPTION 'FAIL: fn_sync_deal_id_to_custom_pipe_entry() sem a guarda G2 no WHERE — LAÇO INFINITO com o sync.';
  END IF;
  IF v_def NOT LIKE '%AND organization_id = NEW.organization_id%' THEN
    RAISE EXCEPTION 'FAIL: fn_sync_deal_id_to_custom_pipe_entry() sem guarda de tenant no WHERE.';
  END IF;

  -- 7g. anon não executa nenhuma das duas; authenticated executa as duas.
  FOR v_sig IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('fn_sync_deal_id_to_custom_pipe_entry','sync_custom_pipe_to_entries')
  LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon ainda executa % (o grant nominal via ALTER DEFAULT PRIVILEGES sobreviveu ao REVOKE FROM PUBLIC).', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated perdeu EXECUTE em %.', v_sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'VALIDATION PASSED: coluna+FK(SET NULL)+índice parcial criados; sync propaga deal_id nas duas vias; trigger reverso com guardas G1+G2 e escopo de tenant; anon sem EXECUTE.';
END$$;
