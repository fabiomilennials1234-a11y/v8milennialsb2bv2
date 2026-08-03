-- ============================================================================
-- M6 — LIMPEZA do responsável cross-org. Passo 1 do L2 (fatia 2, lead-negocio).
--
-- Substitui o rascunho comentado que vivia no fim de `scripts/m6-inventario.sql`
-- — aquele terminava em `...`, não rodava, e cobria 5 das 9 colunas necessárias.
--
-- ORDEM OBRIGATÓRIA:  MEDIR → **LIMPAR (este arquivo)** → acender o M6
--   (`supabase/migrations/20270731000010_assert_member_same_org.sql`).
-- Com a trava no ar antes da limpeza, todo `UPDATE` nas linhas sujas passa a
-- falhar — inclusive o do M4, e inclusive esta limpeza. O bloco 0 abaixo recusa
-- rodar nessa ordem em vez de deixar você descobrir pelo erro.
--
-- Este arquivo é DML. Não é migration, e não deve virar uma (guarda F4:
-- migration é só schema). Rodar com ordem explícita do CTO.
--
-- ── O QUE FOI MEDIDO EM PROD (leitura, 2026-08-03) ──────────────────────────
--
-- 14 pares (tabela, coluna) com valor cross-org — não 9. Duas orgs, dois
-- imports, um dia cada:
--
--   Maria Bonita ← "Gestor Diego" (Mapila, ATIVO) ......... 2026-05-06
--   Zaplub       ← "mayconBalloon" (Good Balloon, inativo) . 2026-03-26
--
--   leads.responsible_id / sdr_id / pre_sale_responsible_id /
--     sale_responsible_id / responsible_user_id ............ 1.594 cada
--   pipeline_entries.assigned_to ......................... 1.091
--   custom_pipe_entries.assigned_to / pre_sale_responsible_id /
--     sale_responsible_id ................................ 1.091 cada
--   campanha_leads.responsible_id / sdr_id /
--     pre_sale_responsible_id / sale_responsible_id ......... 503 cada   ← NOVO
--   campanha_members.team_member_id .......................... 1        ← NOVO
--
--   leads.closer_id e campanha_leads.closer_id ................ 0
--     (limpos hoje; entram no UPDATE mesmo assim — no-op agora, certo depois)
--
-- ── O PONTO CEGO QUE ACHOU OS DOIS PARES NOVOS ─────────────────────────────
--
-- A varredura "genérica" do `m6-inventario.sql` percorre o catálogo, mas exige
-- que a própria tabela tenha `organization_id`. **Oito tabelas referenciam
-- `team_members` sem ter essa coluna** — a org delas vem do pai:
--
--   campanha_allowed_viewers · campanha_leads · campanha_members ·
--   competition_participants · meeting_participants ·
--   pipe_distribution_members · user_badges · whatsapp_instance_allowed_members
--
-- Para essas, "cross-org" só é visível pelo join com o pai. Medindo assim,
-- `campanha_leads` tem 503 linhas em 4 colunas e `campanha_members` tem 1.
-- As outras seis estão em zero. O bloco 4 deste arquivo faz essa varredura, e é
-- ela que deve rodar junto com a do inventário daqui em diante — a varredura que
-- só olha `organization_id` local declara "limpo" um banco que não está.
--
-- ── ZERAR, NÃO REAPONTAR ───────────────────────────────────────────────────
-- Zerar torna verdadeiro o que a tela já mostra: a RLS de `team_members` é
-- org-scoped, então o join já volta vazio e o operador já vê responsável em
-- branco. Reapontar inventaria atribuição — moveria atendimento, e onde houver
-- comissão por responsável, dinheiro — para alguém que não fez o trabalho, em
-- 1.594 leads, sem critério. Maria Bonita tem 6 membros ativos, Zaplub tem 1.
--
-- ⚠️ Preço do zeramento, que a RLS esconde hoje: RPC `SECURITY DEFINER` e edge
-- function com `service_role` têm BYPASSRLS em prod e **hoje resolvem o nome do
-- membro da outra org**. Depois daqui resolvem NULL. Auditar os RPCs de métrica
-- por responsável faz parte de considerar isto fechado.
--
-- ⚠️ Escrever em `leads` acorda `enqueue_lead_webhooks` (não compara OLD/NEW:
-- todo UPDATE vira entrega) e `fn_track_lead_field_changes` (grava em
-- `field_changes` + `lead_history` — aqui é desejável, a limpeza fica auditada).
-- Conferir `webhooks` ativos ANTES: se houver algum, 1.594 entregas saem.
-- ============================================================================

BEGIN;

-- ── 0. GUARDA DE ORDEM — recusa rodar com a trava já acesa ─────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname LIKE 'trg_assert_member_same_org%' AND NOT tgisinternal) THEN
    RAISE EXCEPTION
      'ORDEM INVERTIDA: a trava do M6 já está no ar. Limpe ANTES de acender — com ela ligada, este próprio UPDATE é recusado. Derrube os gatilhos, rode esta limpeza, e acenda de novo.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.webhooks WHERE is_active) THEN
    RAISE WARNING
      'Há webhook ATIVO: `enqueue_lead_webhooks` não compara OLD/NEW, então esta limpeza vai gerar uma entrega por lead tocado (~1.594). Aborte agora se isso não for aceitável.';
  END IF;
END$$;


-- ── 1. BACKUP — sem isto o zeramento é irreversível ────────────────────────
--
-- Formato longo (tabela, coluna, id, valor) de propósito: restaurar é um UPDATE
-- por par, e acrescentar par novo não exige mudar schema de backup.
CREATE TABLE IF NOT EXISTS public.backup_cross_org_responsaveis (
  id             bigserial PRIMARY KEY,
  capturado_em   timestamptz NOT NULL DEFAULT now(),
  tabela         text NOT NULL,
  coluna         text NOT NULL,
  row_id         uuid NOT NULL,
  valor_antigo   uuid NOT NULL,
  org_da_linha   uuid NOT NULL,
  org_do_membro  uuid NOT NULL
);

COMMENT ON TABLE public.backup_cross_org_responsaveis IS
  'Snapshot dos responsáveis cross-org zerados pelo passo 1 do L2 (fatia 2 lead-negocio). Restauração: UPDATE <tabela> SET <coluna> = valor_antigo FROM esta tabela WHERE id = row_id. Descartável depois que o M6 estiver no ar e estável.';

INSERT INTO public.backup_cross_org_responsaveis (tabela, coluna, row_id, valor_antigo, org_da_linha, org_do_membro)
SELECT 'leads','responsible_id', x.id, x.responsible_id, x.organization_id, m.organization_id
  FROM public.leads x JOIN public.team_members m ON m.id = x.responsible_id
 WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'leads','sdr_id', x.id, x.sdr_id, x.organization_id, m.organization_id
  FROM public.leads x JOIN public.team_members m ON m.id = x.sdr_id WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'leads','closer_id', x.id, x.closer_id, x.organization_id, m.organization_id
  FROM public.leads x JOIN public.team_members m ON m.id = x.closer_id WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'leads','pre_sale_responsible_id', x.id, x.pre_sale_responsible_id, x.organization_id, m.organization_id
  FROM public.leads x JOIN public.team_members m ON m.id = x.pre_sale_responsible_id WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'leads','sale_responsible_id', x.id, x.sale_responsible_id, x.organization_id, m.organization_id
  FROM public.leads x JOIN public.team_members m ON m.id = x.sale_responsible_id WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'leads','responsible_user_id', x.id, x.responsible_user_id, x.organization_id, m.organization_id
  FROM public.leads x JOIN public.team_members m ON m.id = x.responsible_user_id WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'pipeline_entries','assigned_to', x.id, x.assigned_to, x.organization_id, m.organization_id
  FROM public.pipeline_entries x JOIN public.team_members m ON m.id = x.assigned_to WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'custom_pipe_entries','assigned_to', x.id, x.assigned_to, x.organization_id, m.organization_id
  FROM public.custom_pipe_entries x JOIN public.team_members m ON m.id = x.assigned_to WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'custom_pipe_entries','pre_sale_responsible_id', x.id, x.pre_sale_responsible_id, x.organization_id, m.organization_id
  FROM public.custom_pipe_entries x JOIN public.team_members m ON m.id = x.pre_sale_responsible_id WHERE m.organization_id <> x.organization_id
UNION ALL SELECT 'custom_pipe_entries','sale_responsible_id', x.id, x.sale_responsible_id, x.organization_id, m.organization_id
  FROM public.custom_pipe_entries x JOIN public.team_members m ON m.id = x.sale_responsible_id WHERE m.organization_id <> x.organization_id
-- Ponto cego: org vem do pai (`campanhas`), não da própria linha.
UNION ALL SELECT 'campanha_leads','responsible_id', x.id, x.responsible_id, pai.organization_id, m.organization_id
  FROM public.campanha_leads x JOIN public.campanhas pai ON pai.id = x.campanha_id
  JOIN public.team_members m ON m.id = x.responsible_id WHERE m.organization_id <> pai.organization_id
UNION ALL SELECT 'campanha_leads','sdr_id', x.id, x.sdr_id, pai.organization_id, m.organization_id
  FROM public.campanha_leads x JOIN public.campanhas pai ON pai.id = x.campanha_id
  JOIN public.team_members m ON m.id = x.sdr_id WHERE m.organization_id <> pai.organization_id
UNION ALL SELECT 'campanha_leads','closer_id', x.id, x.closer_id, pai.organization_id, m.organization_id
  FROM public.campanha_leads x JOIN public.campanhas pai ON pai.id = x.campanha_id
  JOIN public.team_members m ON m.id = x.closer_id WHERE m.organization_id <> pai.organization_id
UNION ALL SELECT 'campanha_leads','pre_sale_responsible_id', x.id, x.pre_sale_responsible_id, pai.organization_id, m.organization_id
  FROM public.campanha_leads x JOIN public.campanhas pai ON pai.id = x.campanha_id
  JOIN public.team_members m ON m.id = x.pre_sale_responsible_id WHERE m.organization_id <> pai.organization_id
UNION ALL SELECT 'campanha_leads','sale_responsible_id', x.id, x.sale_responsible_id, pai.organization_id, m.organization_id
  FROM public.campanha_leads x JOIN public.campanhas pai ON pai.id = x.campanha_id
  JOIN public.team_members m ON m.id = x.sale_responsible_id WHERE m.organization_id <> pai.organization_id
UNION ALL SELECT 'campanha_members','team_member_id', x.id, x.team_member_id, pai.organization_id, m.organization_id
  FROM public.campanha_members x JOIN public.campanhas pai ON pai.id = x.campanha_id
  JOIN public.team_members m ON m.id = x.team_member_id WHERE m.organization_id <> pai.organization_id;


-- ── 2. ZERAR as 3 tabelas que o M6 trava ───────────────────────────────────
--
-- Um UPDATE por tabela, com `CASE` por coluna: a linha suja costuma estar suja
-- em VÁRIAS colunas ao mesmo tempo (em `leads`, nas cinco), e um UPDATE por
-- coluna dispararia `fn_track_lead_field_changes` cinco vezes na mesma linha.
-- O `WHERE` no fim evita tocar linha limpa — sem ele, isto seria um UPDATE em
-- toda a tabela `leads` (35.751 linhas), com histórico para cada uma.
--
-- `EXISTS` correlacionado, e não `FROM <mesma tabela> src JOIN ...`: o auto-join
-- também funciona, mas é fácil de ler errado — e aqui ler errado significa zerar
-- responsável de linha limpa. Cada `EXISTS` é lookup por PK em `team_members`;
-- o custo é uma varredura de `leads`, aceitável num script de uma vez só.
-- Coluna com valor NULL nunca casa o `EXISTS` (não há membro para achar), então
-- linha sem responsável fica intocada sozinha, sem precisar de guarda.

UPDATE public.leads l SET
  responsible_id          = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = l.responsible_id          AND m.organization_id <> l.organization_id) THEN NULL ELSE l.responsible_id          END,
  sdr_id                  = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = l.sdr_id                  AND m.organization_id <> l.organization_id) THEN NULL ELSE l.sdr_id                  END,
  closer_id               = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = l.closer_id               AND m.organization_id <> l.organization_id) THEN NULL ELSE l.closer_id               END,
  pre_sale_responsible_id = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = l.pre_sale_responsible_id AND m.organization_id <> l.organization_id) THEN NULL ELSE l.pre_sale_responsible_id END,
  sale_responsible_id     = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = l.sale_responsible_id     AND m.organization_id <> l.organization_id) THEN NULL ELSE l.sale_responsible_id     END,
  responsible_user_id     = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = l.responsible_user_id     AND m.organization_id <> l.organization_id) THEN NULL ELSE l.responsible_user_id     END
WHERE EXISTS (
  SELECT 1 FROM public.team_members m
   WHERE m.organization_id <> l.organization_id
     AND m.id IN (l.responsible_id, l.sdr_id, l.closer_id,
                  l.pre_sale_responsible_id, l.sale_responsible_id, l.responsible_user_id)
);

UPDATE public.pipeline_entries pe SET assigned_to = NULL
 WHERE EXISTS (SELECT 1 FROM public.team_members m
                WHERE m.id = pe.assigned_to AND m.organization_id <> pe.organization_id);

UPDATE public.custom_pipe_entries c SET
  assigned_to             = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = c.assigned_to             AND m.organization_id <> c.organization_id) THEN NULL ELSE c.assigned_to             END,
  pre_sale_responsible_id = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = c.pre_sale_responsible_id AND m.organization_id <> c.organization_id) THEN NULL ELSE c.pre_sale_responsible_id END,
  sale_responsible_id     = CASE WHEN EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = c.sale_responsible_id     AND m.organization_id <> c.organization_id) THEN NULL ELSE c.sale_responsible_id     END
WHERE EXISTS (
  SELECT 1 FROM public.team_members m
   WHERE m.organization_id <> c.organization_id
     AND m.id IN (c.assigned_to, c.pre_sale_responsible_id, c.sale_responsible_id)
);


-- ── 3. ZERAR o ponto cego (org herdada do pai) ─────────────────────────────
--
-- O M6 NÃO trava estas tabelas, então este bloco não é pré-requisito de acender
-- a trava. Está aqui porque é a mesma sujeira, do mesmo import, e deixá-la é
-- escolher que "cross-org" continue verdadeiro em algum lugar do banco.
-- Para rodar só o mínimo do M6, comente este bloco — o 4 vai acusar o resto.

-- Mesma forma do bloco 2, com a org vindo de `campanhas` em vez da própria linha.
UPDATE public.campanha_leads cl SET
  responsible_id          = CASE WHEN EXISTS (SELECT 1 FROM public.campanhas p JOIN public.team_members m ON m.id = cl.responsible_id          WHERE p.id = cl.campanha_id AND m.organization_id <> p.organization_id) THEN NULL ELSE cl.responsible_id          END,
  sdr_id                  = CASE WHEN EXISTS (SELECT 1 FROM public.campanhas p JOIN public.team_members m ON m.id = cl.sdr_id                  WHERE p.id = cl.campanha_id AND m.organization_id <> p.organization_id) THEN NULL ELSE cl.sdr_id                  END,
  closer_id               = CASE WHEN EXISTS (SELECT 1 FROM public.campanhas p JOIN public.team_members m ON m.id = cl.closer_id               WHERE p.id = cl.campanha_id AND m.organization_id <> p.organization_id) THEN NULL ELSE cl.closer_id               END,
  pre_sale_responsible_id = CASE WHEN EXISTS (SELECT 1 FROM public.campanhas p JOIN public.team_members m ON m.id = cl.pre_sale_responsible_id WHERE p.id = cl.campanha_id AND m.organization_id <> p.organization_id) THEN NULL ELSE cl.pre_sale_responsible_id END,
  sale_responsible_id     = CASE WHEN EXISTS (SELECT 1 FROM public.campanhas p JOIN public.team_members m ON m.id = cl.sale_responsible_id     WHERE p.id = cl.campanha_id AND m.organization_id <> p.organization_id) THEN NULL ELSE cl.sale_responsible_id     END
WHERE EXISTS (
  SELECT 1 FROM public.campanhas p JOIN public.team_members m ON m.organization_id <> p.organization_id
   WHERE p.id = cl.campanha_id
     AND m.id IN (cl.responsible_id, cl.sdr_id, cl.closer_id,
                  cl.pre_sale_responsible_id, cl.sale_responsible_id)
);

DELETE FROM public.campanha_members cm
 USING public.campanhas pai, public.team_members m
 WHERE pai.id = cm.campanha_id
   AND m.id = cm.team_member_id
   AND m.organization_id <> pai.organization_id;
-- `campanha_members` é tabela de vínculo: "membro de outra org participa desta
-- campanha" não tem versão NULL que faça sentido — a linha inteira é o defeito.
-- É 1 linha, e ela está no backup do bloco 1.


-- ── 4. VERIFICAÇÃO — aborta a transação se sobrou sujeira ──────────────────
--
-- Varre o catálogo pelos DOIS caminhos: org na própria linha e org no pai.
-- Falhar aqui desfaz tudo; é de propósito.
DO $$
DECLARE
  r record; v_n bigint; v_total bigint := 0; v_backup bigint;
BEGIN
  -- 4a. org na própria tabela
  FOR r IN
    SELECT c.conrelid::regclass::text AS tabela, a.attname::text AS coluna
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f' AND c.confrelid = 'public.team_members'::regclass
       AND EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = c.conrelid
                    AND o.attname = 'organization_id' AND NOT o.attisdropped)
     ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s x JOIN public.team_members m ON m.id = x.%I
        WHERE m.organization_id <> x.organization_id', r.tabela, r.coluna) INTO v_n;
    IF v_n > 0 THEN
      v_total := v_total + v_n;
      RAISE WARNING 'SOBROU (org local): %.% → % linha(s)', r.tabela, r.coluna, v_n;
    END IF;
  END LOOP;

  -- 4b. org herdada do pai — o ponto cego. Descobre o pai pelo catálogo em vez
  --     de assumir que ele se chama <tabela>_id.
  FOR r IN
    SELECT filho.conrelid::regclass::text AS tabela,
           af.attname::text                AS coluna,
           pai.conrelid::regclass::text    AS via_tabela,
           ap.attname::text                AS via_coluna,
           pai.confrelid::regclass::text   AS pai_tabela
      FROM pg_constraint filho
      JOIN unnest(filho.conkey) kf(attnum) ON true
      JOIN pg_attribute af ON af.attrelid = filho.conrelid AND af.attnum = kf.attnum
      JOIN pg_constraint pai ON pai.conrelid = filho.conrelid AND pai.contype = 'f'
                            AND pai.confrelid <> 'public.team_members'::regclass
      JOIN unnest(pai.conkey) kp(attnum) ON true
      JOIN pg_attribute ap ON ap.attrelid = pai.conrelid AND ap.attnum = kp.attnum
     WHERE filho.contype = 'f' AND filho.confrelid = 'public.team_members'::regclass
       AND NOT EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = filho.conrelid
                        AND o.attname = 'organization_id' AND NOT o.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = pai.confrelid
                    AND o.attname = 'organization_id' AND NOT o.attisdropped)
     ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s x JOIN %s p ON p.id = x.%I
         JOIN public.team_members m ON m.id = x.%I
        WHERE m.organization_id <> p.organization_id',
      r.tabela, r.pai_tabela, r.via_coluna, r.coluna) INTO v_n;
    IF v_n > 0 THEN
      v_total := v_total + v_n;
      RAISE WARNING 'SOBROU (org via %.%): %.% → % linha(s)',
        r.pai_tabela, r.via_coluna, r.tabela, r.coluna, v_n;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_backup FROM public.backup_cross_org_responsaveis;

  IF v_total > 0 THEN
    RAISE EXCEPTION
      'FAIL: ainda há % valor(es) cross-org depois da limpeza. Transação desfeita — acender o M6 agora recusaria UPDATE nessas linhas. Veja os WARNINGs acima.', v_total;
  END IF;

  RAISE NOTICE 'LIMPEZA OK — 0 valores cross-org nos dois caminhos de varredura. % linha(s) no backup (public.backup_cross_org_responsaveis).', v_backup;
END$$;

COMMIT;

-- ── RESTAURAR (se preciso), antes de acender o M6 ──────────────────────────
--
--   UPDATE public.leads l SET responsible_id = b.valor_antigo
--     FROM public.backup_cross_org_responsaveis b
--    WHERE b.tabela = 'leads' AND b.coluna = 'responsible_id' AND b.row_id = l.id;
--
-- ...e assim por diante, um por par. `campanha_members` volta com INSERT, não
-- UPDATE — lá a linha foi apagada, não zerada.
