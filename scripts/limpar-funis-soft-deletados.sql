-- limpar-funis-soft-deletados.sql
--
-- 🚨 DESTRUTIVO E IRREVERSÍVEL. Uma org por vez.
--
-- CONTEXTO: até 25/08/2026 excluir funil era soft delete (`is_active = false`).
-- Sobraram 21 funis mortos em prod, em 4 orgs. Depois da PR #1834 eles somem da
-- lista de Leads, do painel do Lead e do Estúdio — mas as `custom_pipe_entries`
-- deles continuam vivas, e o público "Todos os funis" do Disparo lê essa tabela
-- DIRETO: um lead que só existe num funil "excluído" ainda pode receber
-- mensagem. É isso que este arquivo encerra.
--
-- POR QUE NÃO USA A RPC `delete_custom_pipeline`: a autorização dela sai do JWT
-- (org do chamador ou master). Numa conexão direta pela Management API não há
-- JWT — `auth.uid()` é NULL e `current_setting('role')` vale 'none' — então a
-- RPC recusaria com 42501. Este arquivo replica os MESMOS passos, na mesma
-- ordem, com a autorização vindo do próprio acesso administrativo.
--
-- MEDIDO EM PROD 25/08/2026: 21 funis, 4 orgs, 35 cards, 132 etapas,
-- 33 eventos de etapa e **ZERO vendas** — nenhuma linha de `sale_events` aponta
-- para nenhum deles. É o que torna esta limpeza barata: não há receita para
-- virar "Sem valor" no recorte por funil. ⚠️ Se rodar isto meses depois,
-- REMEÇA: um funil novo pode ter venda, e aí a conta muda.
--
-- DECISÃO DE PRODUTO (25/08): os Negócios (`deals`) NÃO são apagados. O vínculo
-- é `custom_pipe_entries.deal_id → deals ON DELETE SET NULL` — apagar o card
-- desvincula, nunca apaga o Negócio.
--
-- USO:
--   1. Rode ANTES o inventário read-only (o SELECT no rodapé deste arquivo,
--      comentado) para saber o que vai embora nesta org.
--   2. Troque as 4 ocorrências de <ORG_ID> pelo uuid da organização.
--   3. Para ENSAIAR: deixe `ROLLBACK` na linha marcada. O gabarito vai mostrar
--      os números INALTERADOS — é isso que prova que o ensaio não gravou.
--      Para VALER: troque essa linha por `COMMIT`. O gabarito passa a zerar.
--   4. node scripts/prod-sql-win.mjs --file scripts/limpar-funis-soft-deletados.sql
--   5. Confira o gabarito e repita para a próxima org.
--
-- A Management API devolve só o resultado do ÚLTIMO statement — por isso o
-- gabarito vem DEPOIS do COMMIT/ROLLBACK, medindo o estado que ficou de fato.

BEGIN;

-- ── Guarda: aborta a transação inteira se o ORG_ID estiver errado ───────────
DO $guard$
DECLARE
  v_mortos integer;
  v_ativos integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE NOT is_active),
    count(*) FILTER (WHERE is_active)
    INTO v_mortos, v_ativos
    FROM public.custom_pipelines
   WHERE organization_id = '<ORG_ID>'::uuid;

  IF v_mortos = 0 THEN
    RAISE EXCEPTION
      'ABORTADO: nenhum funil com is_active=false nesta org. Confira o ORG_ID.';
  END IF;

  RAISE NOTICE 'Alvos: % funil(is) morto(s). Os % ATIVO(S) não serão tocados.',
    v_mortos, v_ativos;
END
$guard$;

-- Alvos congelados: as etapas seguintes não podem "descobrir" um funil novo no
-- meio do caminho.
CREATE TEMP TABLE _alvos ON COMMIT DROP AS
SELECT id
  FROM public.custom_pipelines
 WHERE organization_id = '<ORG_ID>'::uuid
   AND is_active = false;

-- ── (a) Automações que citam algum alvo ─────────────────────────────────────
--     Já estavam mortas na prática (o motor compara o uuid e devolve `false`).
--     Desativar é honesto: elas somem da lista de "ligadas" em vez de ficarem
--     ligadas e inertes. NÃO reescrevemos o JSON — mexer no grafo às cegas
--     corrompe a automação.
UPDATE public.workflows w
   SET is_active = false, updated_at = now()
 WHERE w.organization_id = '<ORG_ID>'::uuid
   AND w.is_active
   AND EXISTS (
     SELECT 1 FROM _alvos a
      WHERE strpos(w.definition::text, a.id::text) > 0
         OR strpos(w.trigger_config::text, a.id::text) > 0
   );

-- ── (b) Disparo em voo com destino num alvo ─────────────────────────────────
--     NULL = "mantém o lead onde está". Sem isso o release diário entregaria a
--     mensagem e não moveria ninguém, porque o destino não existe mais.
UPDATE public.blast_plans b
   SET post_send_target = NULL, updated_at = now()
 WHERE b.organization_id = '<ORG_ID>'::uuid
   AND b.status IN ('active', 'paused')
   AND EXISTS (
     SELECT 1 FROM _alvos a
      WHERE b.post_send_target->>'pipelineId' = a.id::text
   );

-- ── (c) Filhos antes do pai ─────────────────────────────────────────────────
--     `custom_pipe_entries.stage_id → custom_pipeline_stages` é a única FK da
--     árvore sem cláusula `ON DELETE`. Apagar as entries primeiro torna a
--     ordem de avaliação irrelevante.
DELETE FROM public.custom_pipe_entries
 WHERE pipeline_id IN (SELECT id FROM _alvos);

DELETE FROM public.custom_pipeline_stages
 WHERE pipeline_id IN (SELECT id FROM _alvos);

-- ── (d) O pai. `trg_sync_custom_pipeline` apaga a linha-espelho em `pipelines`,
--     e daí caem `pipeline_entries` e `pipeline_stage_events` por CASCADE.
DELETE FROM public.custom_pipelines
 WHERE id IN (SELECT id FROM _alvos);

-- 🚨 ENSAIO = ROLLBACK · PRA VALER = COMMIT. Troque esta linha:
ROLLBACK;

-- ── GABARITO ────────────────────────────────────────────────────────────────
-- Depois de COMMIT: `funis_mortos` e `espelhos_mortos` = 0, e `funis_ativos`
-- igual ao que era antes.
-- Depois de ROLLBACK: `funis_mortos` continua no valor original — é assim que
-- se prova que o ensaio não gravou nada.
SELECT
  'GABARITO' AS kind,
  (SELECT count(*) FROM public.custom_pipelines
    WHERE organization_id = '<ORG_ID>'::uuid AND is_active = false) AS funis_mortos,
  (SELECT count(*) FROM public.pipelines
    WHERE organization_id = '<ORG_ID>'::uuid AND is_active = false) AS espelhos_mortos,
  (SELECT count(*) FROM public.custom_pipelines
    WHERE organization_id = '<ORG_ID>'::uuid AND is_active)         AS funis_ativos_intactos,
  (SELECT count(*) FROM public.custom_pipe_entries e
     JOIN public.custom_pipelines p ON p.id = e.pipeline_id
    WHERE p.organization_id = '<ORG_ID>'::uuid AND p.is_active = false) AS cards_em_funil_morto;

-- ── INVENTÁRIO (read-only) — rode antes, sozinho, para ver o que vai embora ──
-- SELECT o.name AS org, cp.name AS funil, cp.updated_at::date AS excluido_em,
--        (SELECT count(*) FROM custom_pipe_entries e   WHERE e.pipeline_id = cp.id) AS cards,
--        (SELECT count(*) FROM custom_pipeline_stages s WHERE s.pipeline_id = cp.id) AS etapas,
--        (SELECT count(*) FROM pipeline_stage_events s WHERE s.pipeline_id = cp.id) AS eventos_etapa,
--        (SELECT count(*) FROM sale_events se          WHERE se.pipeline_id = cp.id) AS vendas
--   FROM custom_pipelines cp JOIN organizations o ON o.id = cp.organization_id
--  WHERE cp.is_active = false
--  ORDER BY o.name, eventos_etapa DESC;
