-- ============================================================================
-- Fatia 2 — separação Lead ↔ Negócio: o vendedor pode ASSUMIR um lead.
--
-- POR QUÊ
-- -------
-- A fatia 1 já separou os dois donos: o NEGÓCIO tem dono explícito
-- (`deals.owner_id` → team_members, ON DELETE SET NULL) e o LEAD é da
-- organização. Faltava o meio-termo que o CTO pediu (decisão C): o lead
-- continua da organização, mas um vendedor pode puxá-lo pra si — "esse é meu,
-- estou trabalhando nele" — sem que isso vire atribuição formal de
-- responsabilidade (`responsible_id`/`sdr_id`/`closer_id`, que carregam
-- comissão, metas e roteamento).
--
-- POR QUE COLUNA NO LEAD, E NÃO TABELA `lead_claims`
-- --------------------------------------------------
-- Porque a auditoria já existe e é de graça. `fn_track_lead_field_changes`
-- grava CADA mudança de campo do lead em `field_changes` + `lead_history`
-- (33.242 eventos `field_updated` em 90 dias) — quem assumiu, quando, de quem
-- pegou, saem do histórico que a UI do lead já renderiza. Uma tabela própria só
-- ganharia se existisse FILA (vários pretendentes) ou EXPIRAÇÃO (claim que
-- caduca em N horas). Ninguém pediu nenhum dos dois, e tabela criada "por via
-- das dúvidas" custa RLS, policies, índice, grants e mais um join no board.
--
-- POR ISSO A ALLOW-LIST VEM NA MESMA MIGRATION
-- --------------------------------------------
-- `v_tracked_fields` é uma lista fechada de 13 campos. Coluna que não está nela
-- é botão SEM auditoria — e "a auditoria já existe" foi justamente o argumento
-- que fechou a decisão C. Separar as duas coisas em migrations diferentes
-- deixaria uma janela em que o botão existe e o histórico mente por omissão.
-- Andam juntas ou não andam.
--
-- ARMADILHAS CONHECIDAS
-- ---------------------
-- 1. NÃO recriar o trigger. `trg_lead_field_changes` é
--    `AFTER UPDATE ON leads FOR EACH ROW` SEM lista de colunas — ele já dispara
--    em qualquer UPDATE, inclusive nos das colunas novas. `CREATE OR REPLACE`
--    da função basta. Recriar o trigger seria risco (janela sem trigger,
--    ordem alfabética de disparo entre os 20 triggers de `leads`) sem ganho.
--
-- 2. A função é SECURITY DEFINER com `SET search_path TO 'public', 'extensions'`
--    e o corpo referencia `field_changes`, `lead_history` e `auth.uid()` SEM
--    qualificar schema. Perder o `SET` no replace quebraria a função em runtime
--    — e o erro apareceria como "UPDATE de lead falhou", não como "auditoria
--    quebrada". O corpo abaixo é cópia fiel de `pg_get_functiondef` da branch de
--    QA; a ÚNICA diferença é `'claimed_by'` somado ao array.
--
-- 3. ACL: `CREATE OR REPLACE` preserva o `proacl` existente (hoje
--    `{postgres,authenticated,service_role}`, anon já fora). Mas este projeto
--    concede `anon` NOMINALMENTE via `ALTER DEFAULT PRIVILEGES`, e
--    `REVOKE ... FROM PUBLIC` sozinho não encosta nesse grant nominal. Os dois
--    revokes ficam explícitos por baixo custo e para o dia em que esta função
--    for recriada do zero num ambiente novo.
--
-- 4. Assumir um lead NÃO dispara workflow. `trigger_workflow_field_changed`
--    tem allow-list PRÓPRIA e independente (`company, segment, urgency,
--    faturamento, rating, email, phone, name`) — `claimed_by` fica de fora de
--    propósito: claim é ato interno de organização de trabalho, não evento de
--    negócio. Transformá-lo em gatilho de automação (e portanto em disparo de
--    WhatsApp) seria decisão de produto, em outra migration, com o CTO ciente.
--
-- 5. Grants de coluna: `leads` tem ACL de TABELA (`relacl` com
--    `authenticated=arwdDxtm`) e ZERO colunas com `attacl` próprio. Coluna nova
--    herda SELECT/INSERT/UPDATE automaticamente — nenhum GRANT é necessário
--    aqui, e emitir um converteria o grant de tabela em grants por coluna,
--    quebrando toda coluna futura. A verificação confirma a herança em vez de
--    presumi-la.
--
-- 6. RLS não muda, e isso tem consequência pra fatia 3.
--    `leads_update_by_responsibility_and_permissions` exige
--    `is_user_admin() OR has_feature_permission('leads.view_all') OR
--     já-é-responsável`. Logo: **só assume quem já enxerga/edita o lead** — que
--    é exatamente o cenário do pool aberto que a decisão C descreve (org com
--    `leads.view_all` ligado, lead sem dono, vendedor puxa). Alargar a policy
--    pra deixar qualquer membro assumir lead que ele não pode ver seria
--    mudança de SEGURANÇA multi-tenant, não de feature — fora deste escopo,
--    deliberadamente.
--
-- 7. `CREATE INDEX CONCURRENTLY` não é opção: migration roda dentro de
--    transação. Custo medido em prod: `leads` = 33.852 linhas / 14 MB de heap,
--    e o índice nasce VAZIO (coluna 100% NULL) — o SHARE lock dura o tempo de
--    um scan de 14 MB, milissegundos. Não vale a complexidade de sair da
--    transação.
--
-- 8. ⚠️ A INVARIANTE DO PAR É UNIDIRECIONAL, E ISSO NÃO É DESLEIXO.
--    A forma óbvia — `CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))` —
--    é INCOMPATÍVEL com o `ON DELETE SET NULL` desta mesma migration, e o
--    conflito não aparece no apply: aparece meses depois, na cara de quem
--    remove um vendedor. A ação referencial emite um UPDATE interno que zera
--    SÓ a coluna da FK (`claimed_by`); `claimed_at` sobrevive. Esse UPDATE é
--    avaliado contra os CHECKs da tabela, e `(NULL IS NULL) = (ts IS NULL)`
--    vira `true = false` → SQLSTATE 23514. Ou seja: apagar um team_member que
--    tenha QUALQUER lead assumido aborta, com uma mensagem sobre
--    `leads_claim_pair_check` no meio de uma operação de `team_members`.
--    O caminho é vivo e é HARD delete, não soft: `useDeleteTeamMember`
--    (src/modules/identity/org-team/hooks/useTeamMembers.ts:151) faz
--    `.from('team_members').delete()` direto do botão de remover membro da
--    tela Equipe, e as edge functions `remove-org-member`,
--    `assign-user-to-org` e `attach-to-org-by-pending-invite` fazem o mesmo.
--    service_role não salva ninguém: BYPASSRLS não bypassa CHECK. E como
--    `team_members.organization_id` referencia `organizations` com CASCADE,
--    excluir uma organização pode bater no mesmo muro.
--    Reproduzido na branch de QA com fixture temporária (pai/filho, mesma FK,
--    mesma CHECK) dentro de transação abortada de propósito:
--      DELETE BARRADO -> 23514 / constraint=_rv_pair
--    Por isso a constraint guarda só a metade que importa — nunca existir
--    claim sem carimbo de tempo:
--      CHECK (claimed_by IS NULL OR claimed_at IS NOT NULL)
--    (by=X, at=NULL) rejeitado · (by=NULL, at=ts) aceito · (X, ts) aceito ·
--    (NULL, NULL) aceito. O assert 6c não confere o TEXTO da constraint: lê a
--    expressão do catálogo e AVALIA os quatro estados, porque foi exatamente
--    uma verificação que só olhava "a constraint existe?" que deixou a
--    combinação quebrada passar como verde.
--
-- 9. CONTRATO QUE CAI NA FATIA 3, consequência direta da armadilha 8:
--    a) "lead não assumido" é `claimed_by IS NULL` — NUNCA `claimed_at IS
--       NULL`. O índice parcial já é sobre `claimed_by`, então UI, RPC e
--       relatório precisam usar a mesma chave pra não divergir do índice.
--    b) `claimed_at` órfã (com `claimed_by` NULL) é ESTADO LEGÍTIMO e
--       informativo — "esteve assumido até o vendedor sair da equipe". Não é
--       lixo e não deve ser limpo por backfill.
--    c) Devolver ao pool pela UI continua zerando os DOIS campos:
--       `SET claimed_by = NULL, claimed_at = NULL`.
--
-- 10. HERDADO — `claimed_by` não tem amarra de organização. Aceito, com
--     requisito compensatório na fatia 3.
--     A FK aponta pra `team_members(id)` global, e a RLS não fecha o VALOR:
--     `leads_update_by_responsibility_and_permissions` tem `with_check` NULL
--     (medido na branch de QA), então o Postgres reusa o `USING`, que valida a
--     ORG DA LINHA (`organization_id IN get_my_organization_ids()`) e nada
--     sobre o que se grava em `claimed_by`. Um usuário autenticado da org A
--     consegue, por API, gravar um team_member da org B num lead da org A.
--     Não vaza dado (a RLS de `team_members` continua escondendo o nome), mas
--     é sujeira multi-tenant: aparece como responsável em branco na UI e
--     envenena qualquer relatório de "meus assumidos".
--     É exatamente o shape que `responsible_id`, `sdr_id`, `closer_id` e
--     `deals.owner_id` já têm — NÃO é regressão desta migration. Fechar no
--     banco custaria um trigger de validação novo numa tabela que já carrega
--     20 triggers, em UPDATE de lead (caminho quentíssimo), pra uma classe que
--     nenhuma das colunas irmãs trata — divergência de shape que esta fatia
--     não foi pedida pra pagar. A 20270730000010 tomou a mesma decisão e
--     escreveu o HERDADO em vez de alargar o diff.
--     REQUISITO EXPLÍCITO DA FATIA 3, então: a UI/RPC de assumir DEVE resolver
--     `claimed_by` a partir do team_member do próprio usuário na org do lead —
--     nunca de um id vindo do cliente. O commit dbdf3411 desta mesma frente
--     ("recusa dono de outra organização ao abrir negócio") é o precedente de
--     quanto custa descobrir isso depois.
--
-- ROLLBACK
-- --------
-- Companheiro em `supabase/migrations/rollback/20270730000020_leads_claim.sql`.
-- Resumo: é aditiva, então reverter = `CREATE OR REPLACE` da função com o array
-- de 13 campos + DROP das duas colunas (o índice e as constraints caem junto).
-- ⚠️ Reverter APAGA os claims existentes — e também o resíduo de `claimed_at`
-- descrito na armadilha 8. Os eventos em `field_changes` / `lead_history`
-- sobrevivem, então o estado é reconstruível, mas não automaticamente. Reverter
-- só o CÓDIGO (esconder o botão) não precisa de schema: coluna nullable
-- ignorada é inerte.
--
-- Só schema: nenhum dado de cliente é lido, escrito ou movido (guarda F4).
-- ============================================================================

-- ── 1. Colunas ──────────────────────────────────────────────────────────────
-- Nullable e sem default: o estado natural de um lead é NÃO assumido, e
-- `ADD COLUMN` nullable sem default não reescreve a tabela.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS claimed_by uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN public.leads.claimed_by IS
  'Vendedor que ASSUMIU o lead para si (decisão C: o lead é da organização, o negócio é do vendedor). NÃO é atribuição formal de responsabilidade — para isso existem responsible_id / sdr_id / closer_id, que carregam comissão e roteamento. Auditado por fn_track_lead_field_changes.';
COMMENT ON COLUMN public.leads.claimed_at IS
  'Momento em que claimed_by assumiu o lead. A constraint leads_claim_pair_check garante a metade que importa: claim SEM carimbo é impossível (claimed_by preenchido exige claimed_at). O inverso NÃO é garantido, de propósito — quando o vendedor sai da equipe a FK zera só claimed_by e claimed_at fica como resíduo histórico ("esteve assumido até o vendedor sair"). Logo: lead não assumido é claimed_by IS NULL, NUNCA claimed_at IS NULL.';

-- FK nomeada explicitamente pra bater com as irmãs (leads_responsible_id_fkey,
-- leads_sdr_id_fkey, ...). ON DELETE SET NULL: remover um vendedor da equipe
-- devolve ao pool os leads que ele tinha assumido (zera `claimed_by`) em vez de
-- estourar erro de FK — e nunca apaga o lead. O que a ação referencial NÃO faz
-- é zerar `claimed_at` junto: ela toca só a coluna da FK. Esse resíduo é a
-- razão de a invariante do par ser unidirecional — ver armadilha 8.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads'::regclass AND conname = 'leads_claimed_by_fkey'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_claimed_by_fkey
      FOREIGN KEY (claimed_by) REFERENCES public.team_members(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ── 2. Invariante do par ────────────────────────────────────────────────────
-- Par nullable sem invariante é como se produz lixo do tipo "assumido por
-- ninguém desde 3ª feira". A constraint torna o contrato EXPLÍCITO pra quem
-- escrever a UI: assumir = `SET claimed_by = <tm>, claimed_at = now()`;
-- devolver ao pool = `SET claimed_by = NULL, claimed_at = NULL`. Escrever só a
-- primeira metade — claim sem carimbo — falha na hora, alto e claro, em vez de
-- sujar silenciosamente.
--
-- UNIDIRECIONAL, e não `(claimed_by IS NULL) = (claimed_at IS NULL)`. A forma
-- bidirecional é a óbvia e está ERRADA aqui: ela é incompatível com o
-- `ON DELETE SET NULL` da FK acima e quebraria a remoção de vendedor com
-- SQLSTATE 23514 — reprodução e caminho de código na armadilha 8 do cabeçalho.
-- O estado (claimed_by NULL, claimed_at preenchido) é aceito DE PROPÓSITO: é o
-- resíduo que a ação referencial produz, e ele carrega informação em vez de
-- lixo. A metade que realmente importa — nunca existir claim sem carimbo de
-- tempo — continua garantida, e é ela que impede a sujeira que a constraint
-- foi criada pra impedir.
-- Validação imediata (sem NOT VALID/VALIDATE) porque a tabela tem 14 MB e as
-- duas colunas acabaram de nascer 100% NULL — o scan é trivial.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads'::regclass AND conname = 'leads_claim_pair_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_claim_pair_check
      CHECK (claimed_by IS NULL OR claimed_at IS NOT NULL);
  END IF;
END$$;

-- ── 3. Índice ───────────────────────────────────────────────────────────────
-- Espelha `idx_leads_sdr_id` (parcial, coluna única) — precedente do repo pra
-- exatamente este formato de campo: FK opcional pra team_members, esparsa.
-- Coluna única e não composto com organization_id de propósito: além da
-- listagem "meus leads assumidos", este índice é o que a manutenção do FK
-- `ON DELETE SET NULL` usa ao desligar um vendedor, e essa busca é por
-- `claimed_by` sozinho — um composto liderado por organization_id não serviria
-- e deixaria o DELETE de team_member em seq scan.
-- Parcial porque a esmagadora maioria dos leads nunca será assumida: o índice
-- indexa só as linhas que interessam.
CREATE INDEX IF NOT EXISTS idx_leads_claimed_by
  ON public.leads (claimed_by)
  WHERE claimed_by IS NOT NULL;

-- ── 4. Auditoria: soma 'claimed_by' à allow-list ────────────────────────────
-- Corpo IDÊNTICO ao que roda hoje (pg_get_functiondef), com uma única mudança:
-- `'claimed_by'` no fim do array. SECURITY DEFINER e o SET search_path são
-- parte do contrato — ver armadilha 2 no cabeçalho.
--
-- `claimed_at` NÃO entra na allow-list: ele é redundante com o `created_at` do
-- próprio evento de auditoria, e rastreá-lo geraria uma segunda linha em
-- `field_changes` por claim, dobrando o volume sem informação nova.
CREATE OR REPLACE FUNCTION public.fn_track_lead_field_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_field text;
  v_tracked_fields text[] := ARRAY[
    'name', 'company', 'email', 'phone', 'origin',
    'rating', 'qualification_score',
    'responsible_id', 'sdr_id', 'closer_id',
    'ai_disabled', 'notes', 'segment',
    'claimed_by'
  ];
  v_old_val text;
  v_new_val text;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_field IN ARRAY v_tracked_fields
  LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', v_field, v_field)
      INTO v_old_val, v_new_val
      USING OLD, NEW;

    IF v_old_val IS DISTINCT FROM v_new_val THEN
      INSERT INTO field_changes (organization_id, entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES (NEW.organization_id, 'lead', NEW.id, v_field, v_old_val, v_new_val, auth.uid());

      v_changes := v_changes || jsonb_build_object(
        v_field, jsonb_build_object('from', v_old_val, 'to', v_new_val)
      );
    END IF;
  END LOOP;

  IF v_changes != '{}'::jsonb THEN
    INSERT INTO lead_history (lead_id, organization_id, action, description, source, metadata, created_by)
    VALUES (
      NEW.id,
      NEW.organization_id,
      'field_updated',
      'Campos atualizados',
      'system',
      jsonb_build_object('changes', v_changes),
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 5. ACL da função ────────────────────────────────────────────────────────
-- Redundante hoje (o replace preserva o proacl, que já exclui anon), explícito
-- de propósito: se esta função for algum dia recriada do zero num ambiente
-- novo, ela nasce com EXECUTE pra PUBLIC **e** com o grant nominal de `anon`
-- do ALTER DEFAULT PRIVILEGES deste projeto — revogar de um só deixa a outra
-- porta aberta. `authenticated` MANTÉM o grant: é sob a identidade dele que o
-- trigger roda no UPDATE feito pelo app.
REVOKE ALL     ON FUNCTION public.fn_track_lead_field_changes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_track_lead_field_changes() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_track_lead_field_changes() TO authenticated, service_role;

-- ── 6. Verificação — aborta a transação se qualquer premissa não bater ──────
DO $$
DECLARE
  v_src         text;
  v_proconfig   text[];
  v_secdef      boolean;
  v_field       text;
  v_esperados   text[] := ARRAY[
    'name', 'company', 'email', 'phone', 'origin',
    'rating', 'qualification_score',
    'responsible_id', 'sdr_id', 'closer_id',
    'ai_disabled', 'notes', 'segment',
    'claimed_by'
  ];
  v_typ         text;
  v_nullable    text;
  v_trigdef     text;
  v_trigenabled "char";
  v_confdel     "char";
  v_conoid      oid;
  v_condef      text;
  v_convalid    boolean;
  v_expr        text;
  v_ok          boolean;
  v_arr         text;
  v_n           int;
BEGIN
  -- 6a. As duas colunas existem, com o tipo certo e nullable.
  SELECT format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END
    INTO v_typ, v_nullable
  FROM pg_attribute a
  WHERE a.attrelid = 'public.leads'::regclass AND a.attname = 'claimed_by' AND NOT a.attisdropped;
  IF v_typ IS NULL THEN
    RAISE EXCEPTION 'FAIL: leads.claimed_by não existe.';
  END IF;
  IF v_typ <> 'uuid' OR v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'FAIL: leads.claimed_by é % (nullable=%), esperava uuid nullable.', v_typ, v_nullable;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END
    INTO v_typ, v_nullable
  FROM pg_attribute a
  WHERE a.attrelid = 'public.leads'::regclass AND a.attname = 'claimed_at' AND NOT a.attisdropped;
  IF v_typ IS NULL THEN
    RAISE EXCEPTION 'FAIL: leads.claimed_at não existe.';
  END IF;
  IF v_typ <> 'timestamp with time zone' OR v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'FAIL: leads.claimed_at é % (nullable=%), esperava timestamptz nullable.', v_typ, v_nullable;
  END IF;

  -- 6b. FK pra team_members com ON DELETE SET NULL (confdeltype = 'n').
  --     Sem isso, remover um vendedor viraria erro de FK em vez de devolver ao
  --     pool os leads que ele tinha assumido. O que a ação referencial NÃO faz
  --     é zerar `claimed_at` junto — ela toca só a coluna da FK. O resíduo que
  --     sobra é o que 6c prova ser tolerado pela invariante do par.
  SELECT c.confdeltype INTO v_confdel
  FROM pg_constraint c
  WHERE c.conrelid  = 'public.leads'::regclass
    AND c.conname   = 'leads_claimed_by_fkey'
    AND c.contype   = 'f'
    AND c.confrelid = 'public.team_members'::regclass;

  IF v_confdel IS NULL THEN
    RAISE EXCEPTION 'FAIL: leads_claimed_by_fkey ausente ou não referencia team_members.';
  END IF;
  IF v_confdel <> 'n' THEN
    RAISE EXCEPTION 'FAIL: leads_claimed_by_fkey com confdeltype=% (esperava ''n'' = ON DELETE SET NULL).', v_confdel;
  END IF;

  -- 6c. Invariante do par: VALIDADA **e na FORMA compatível com a FK**.
  --     Este assert existe por causa de um defeito real: a versão anterior
  --     certificava só a EXISTÊNCIA da constraint e o `confdeltype='n'` da FK.
  --     Cada metade passava isolada, a migration aplicava verde — e a
  --     COEXISTÊNCIA das duas (SET NULL + CHECK bidirecional) deixava o DELETE
  --     de team_member quebrado com SQLSTATE 23514. Verificação que não
  --     enxerga a interação sobre a qual se pronuncia é confiança falsa.
  --     Por isso não comparamos o TEXTO da constraint (frágil: depende de como
  --     o Postgres deparsa): lemos a expressão do catálogo e a AVALIAMOS nos
  --     quatro estados possíveis do par. Isso trava o COMPORTAMENTO.
  --     Só schema: avalia expressão com literais, não lê nem escreve linha
  --     nenhuma de `leads` (guarda F4).
  SELECT c.oid, pg_get_constraintdef(c.oid), c.convalidated
    INTO v_conoid, v_condef, v_convalid
  FROM pg_constraint c
  WHERE c.conrelid = 'public.leads'::regclass
    AND c.conname  = 'leads_claim_pair_check'
    AND c.contype  = 'c';

  IF v_conoid IS NULL THEN
    RAISE EXCEPTION 'FAIL: leads_claim_pair_check ausente.';
  END IF;
  IF NOT v_convalid THEN
    RAISE EXCEPTION 'FAIL: leads_claim_pair_check está NOT VALID — linha inconsistente passaria calada. Def: %', v_condef;
  END IF;

  v_expr := substring(v_condef from '^CHECK \((.*)\)$');
  IF v_expr IS NULL THEN
    RAISE EXCEPTION 'FAIL: não consegui extrair a expressão de leads_claim_pair_check para avaliá-la. Def: %', v_condef;
  END IF;
  v_expr := regexp_replace(v_expr, '\mclaimed_by\M', '($1)::uuid',        'g');
  v_expr := regexp_replace(v_expr, '\mclaimed_at\M', '($2)::timestamptz', 'g');

  -- Semântica de CHECK: a linha só é REJEITADA quando a expressão dá FALSE
  -- (NULL passa). Daí os testes serem `IS FALSE` / `IS NOT FALSE`, e não `=`.

  --  (i) Lead livre — o estado de 100% da tabela hoje.
  EXECUTE 'SELECT ' || v_expr INTO v_ok USING NULL::uuid, NULL::timestamptz;
  IF v_ok IS FALSE THEN
    RAISE EXCEPTION 'FAIL: a invariante rejeita lead NÃO assumido (by=NULL, at=NULL) — nenhum lead poderia ser criado. Def: %', v_condef;
  END IF;

  -- (ii) Claim completo — o caminho feliz do botão "assumir".
  EXECUTE 'SELECT ' || v_expr INTO v_ok USING gen_random_uuid(), now();
  IF v_ok IS FALSE THEN
    RAISE EXCEPTION 'FAIL: a invariante rejeita claim completo (by + at) — assumir lead seria impossível. Def: %', v_condef;
  END IF;

  -- (iii) Claim sem carimbo — é a metade que a constraint existe pra barrar.
  EXECUTE 'SELECT ' || v_expr INTO v_ok USING gen_random_uuid(), NULL::timestamptz;
  IF v_ok IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: a invariante ACEITA claim sem carimbo (by preenchido, at=NULL) — é exatamente o lixo "assumido por ninguém desde 3ª feira" que ela deveria impedir. Def: %', v_condef;
  END IF;

  -- (iv) O resíduo do ON DELETE SET NULL — o assert que faltava.
  --      6b acabou de exigir confdeltype='n', então ESTE estado é produzido de
  --      verdade toda vez que um vendedor sai da equipe: a FK zera `claimed_by`
  --      e `claimed_at` fica. Se a invariante o rejeitar, remover membro aborta
  --      com 23514 (caminho vivo e hard delete: useTeamMembers.ts:151 + 3 edge
  --      functions). Se um dia a FK virar NO ACTION com trigger que zera os
  --      dois campos, é este assert que precisa ser revisto junto com ela.
  EXECUTE 'SELECT ' || v_expr INTO v_ok USING NULL::uuid, now();
  IF v_ok IS FALSE THEN
    RAISE EXCEPTION 'FAIL: a invariante rejeita (claimed_by NULL, claimed_at preenchido) — estado que o ON DELETE SET NULL de leads_claimed_by_fkey produz. Com esta CHECK, remover um vendedor com lead assumido aborta com SQLSTATE 23514. Use a forma unidirecional: CHECK (claimed_by IS NULL OR claimed_at IS NOT NULL). Def atual: %', v_condef;
  END IF;

  -- 6d. Índice parcial existe.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'leads' AND indexname = 'idx_leads_claimed_by'
  ) THEN
    RAISE EXCEPTION 'FAIL: idx_leads_claimed_by não foi criado.';
  END IF;

  -- 6e. A função existe e continua SECURITY DEFINER com search_path setado —
  --     o replace não pode ter comido nenhum dos dois.
  SELECT p.prosrc, p.proconfig, p.prosecdef
    INTO v_src, v_proconfig, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_track_lead_field_changes';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: fn_track_lead_field_changes desapareceu.';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'FAIL: fn_track_lead_field_changes perdeu SECURITY DEFINER.';
  END IF;
  IF v_proconfig IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(v_proconfig) c WHERE c LIKE 'search_path=%'
  ) THEN
    RAISE EXCEPTION 'FAIL: fn_track_lead_field_changes perdeu o SET search_path — o corpo usa nomes não qualificados e quebraria em runtime.';
  END IF;

  -- 6f. 'claimed_by' entrou E nenhum dos 13 campos originais saiu. O segundo
  --     teste é o que importa: um replace desatento que "reescreve o array"
  --     apagaria auditoria existente sem nenhum sintoma imediato.
  --     Recortamos o ARRAY antes de testar. Procurar o nome do campo no corpo
  --     INTEIRO não serve: passaria com o array já esvaziado, bastando o nome
  --     sobrar num comentário — ou seja, era cego justamente no cenário que
  --     este assert diz cobrir.
  v_arr := substring(v_src from 'v_tracked_fields\s+text\[\]\s*:=\s*ARRAY\[(.*?)\]');
  IF v_arr IS NULL THEN
    RAISE EXCEPTION 'FAIL: não achei a declaração de v_tracked_fields no corpo de fn_track_lead_field_changes — a allow-list mudou de forma e este assert ficou cego.';
  END IF;

  FOREACH v_field IN ARRAY v_esperados
  LOOP
    IF position(quote_literal(v_field) in v_arr) = 0 THEN
      RAISE EXCEPTION 'FAIL: campo % sumiu da allow-list v_tracked_fields.', v_field;
    END IF;
  END LOOP;

  -- Cardinalidade: campo A MAIS também é mudança que ninguém revisou.
  SELECT count(*) INTO v_n FROM regexp_matches(v_arr, '''[a-z_]+''', 'g');
  IF v_n <> array_length(v_esperados, 1) THEN
    RAISE EXCEPTION 'FAIL: allow-list tem % entradas, esperava %. Array: %', v_n, array_length(v_esperados, 1), v_arr;
  END IF;

  -- `claimed_at` fica FORA de propósito (ver seção 4): rastreá-lo geraria uma
  -- segunda linha em field_changes por claim, sem informação nova. Decisão
  -- declarada no cabeçalho merece guarda, não só comentário.
  IF position(quote_literal('claimed_at') in v_arr) > 0 THEN
    RAISE EXCEPTION 'FAIL: claimed_at entrou na allow-list — dobra o volume de field_changes por claim sem informação nova.';
  END IF;

  -- 6g. O trigger continua AFTER UPDATE FOR EACH ROW, habilitado e SEM lista
  --     de colunas. Se alguém no futuro trocar por "UPDATE OF <cols>", a
  --     auditoria de claimed_by morre calada — este assert é o alarme.
  SELECT pg_get_triggerdef(t.oid), t.tgenabled
    INTO v_trigdef, v_trigenabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.leads'::regclass AND t.tgname = 'trg_lead_field_changes' AND NOT t.tgisinternal;

  IF v_trigdef IS NULL THEN
    RAISE EXCEPTION 'FAIL: trigger trg_lead_field_changes não existe em leads.';
  END IF;
  IF v_trigenabled <> 'O' THEN
    RAISE EXCEPTION 'FAIL: trigger trg_lead_field_changes está desabilitado (tgenabled=%).', v_trigenabled;
  END IF;
  IF v_trigdef LIKE '%UPDATE OF%' THEN
    RAISE EXCEPTION 'FAIL: trg_lead_field_changes ganhou lista de colunas — claimed_by não seria auditado. Def: %', v_trigdef;
  END IF;

  -- 6h. ACL: anon fora, authenticated dentro.
  IF has_function_privilege('anon', 'public.fn_track_lead_field_changes()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon executa fn_track_lead_field_changes.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_track_lead_field_changes()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated NÃO executa fn_track_lead_field_changes — todo UPDATE de lead quebraria.';
  END IF;

  -- 6i. A coluna nova herdou o grant de TABELA. Se um dia alguém converter
  --     leads pra grants por coluna, este assert pega — o sintoma seria
  --     "assumir lead não salva" sem erro visível de permissão.
  IF NOT has_column_privilege('authenticated', 'public.leads', 'claimed_by', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated não tem UPDATE em leads.claimed_by.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.leads', 'claimed_at', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: authenticated não tem UPDATE em leads.claimed_at.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: leads.claimed_by/claimed_at criados; FK ON DELETE SET NULL e invariante do par UNIDIRECIONAL provadas compatíveis nos 4 estados (inclusive o resíduo que a remoção de vendedor produz); índice parcial no lugar; allow-list de auditoria com exatamente 14 campos e sem claimed_at; trigger e ACL intactos.';
END$$;
