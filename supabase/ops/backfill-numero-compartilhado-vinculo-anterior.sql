-- supabase/ops/backfill-numero-compartilhado-vinculo-anterior.sql
--
-- Backfill da regressão de 19/10 (número em 2+ cadastros sem negócio aberto
-- deixou de vincular). Aplica às mensagens ÓRFÃS a regra 2c da
-- 20280102000000: herdar o lead da mensagem VINCULADA anterior mais recente do
-- mesmo número.
--
-- NÃO é migration: não roda no deploy de schema. Execução manual (humano), como
-- postgres, SÓ DEPOIS da migration
-- supabase/migrations/20280102000000_numero_compartilhado_escolha_e_vinculo_anterior.sql
-- aplicada — depende de private.leads_vivos_do_numero,
-- private.vinculo_de_lead_tem_efeito_externo e de
-- public.whatsapp_numero_lead_escolhido. O passo 0 aborta se faltar algum.
--
-- Alvo (todas as orgs; só toca número ambíguo):
--   whatsapp_messages com lead_id NULL, created_at >= 2026-10-19, fora de grupo
--   e de caixa de cobrança, cujo número (org, normalized_phone):
--     * tem 2+ leads vivos (leads.normalized_phone ∪ lead_phones vivos);
--     * não tem negócio aberto em nenhum deles (com negócio, a regra 2b já
--       decide as mensagens novas; as antigas ficam como estão);
--     * não tem escolha explícita (com escolha, a RPC já vinculou as órfãs);
--   e existe mensagem viva do mesmo número, criada ANTES da órfã, vinculada a um
--   lead que ainda é candidato -> recebe o lead da mais recente dessas.
--
-- Medido em prod (read-only, 09/11/2026, mesmo SELECT do passo 1):
--   1.096 mensagens em 58 conversas, todas da Café Jurerê
--   (4922638c-4909-494e-ba10-12282ec0b161); 144 delas da Cliente Exemplo
--   (42999990001 -> <lead PF>); 588 são outgoing manual;
--   0 da Riofix.
--
-- Efeito colateral (gatilhos de UPDATE de whatsapp_messages em prod, 09/11):
--   * trg_first_human_outbound_stage (AFTER UPDATE OF lead_id, outgoing manual):
--     avança etapa SÓ em pipeline com config.first_human_outbound_stage.enabled.
--     Nenhum na Café Jurerê (1 em prod, outra org).
--   * riofix_proposal_message_update: só org Riofix -> enfileira workflow.
--   * trg_resolve_message_lead_id_zz_cobranca (BEFORE): zera lead em caixa de
--     cobrança — essas caixas estão fora do alvo.
--   Aviso, webhook, histórico, resumo de IA, detecção de resposta: AFTER INSERT,
--   não disparam. Não há GUC de bypass nesses gatilhos e este arquivo NÃO cria um:
--   a GUARDA abaixo aborta tudo se o alvo encostar em org com efeito externo
--   (private.vinculo_de_lead_tem_efeito_externo — a mesma regra que faz a RPC
--   vincular só incoming: Riofix, ou pipeline com first_human_outbound_stage). Se abortar,
--   o humano decide caso a caso.
--
-- Idempotente: a 2ª execução não acha órfã com vínculo anterior (já vinculadas)
-- e termina com 0. Volume pequeno (~1,1 mil linhas): UPDATE único, set-based,
-- com teto de sanidade.
--
-- Trilha: cada linha tocada (mensagem e resumo) fica em private.* com o lead
-- gravado, para o rollback desfazer EXATAMENTE o que este arquivo fez:
-- supabase/ops/rollback-backfill-numero-compartilhado-vinculo-anterior.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Passo 0: pré-requisitos da forward.
DO $$
BEGIN
  IF to_regprocedure('private.leads_vivos_do_numero(uuid, text)') IS NULL
     OR to_regprocedure('private.vinculo_de_lead_tem_efeito_externo(uuid)') IS NULL
     OR to_regclass('public.whatsapp_numero_lead_escolhido') IS NULL THEN
    RAISE EXCEPTION 'backfill abortado: aplique antes a migration 20280102000000_numero_compartilhado_escolha_e_vinculo_anterior';
  END IF;
END
$$;

-- Passo 1: alvo congelado (mesmo SELECT medido em prod).
CREATE TEMP TABLE _backfill_numero_alvo ON COMMIT DROP AS
WITH orfas AS (
  SELECT m.id, m.organization_id, m.normalized_phone, m.instance_id,
         m.created_at, m."timestamp"
    FROM public.whatsapp_messages m
   WHERE m.lead_id IS NULL
     AND m.created_at >= '2026-10-19'
     AND m.normalized_phone IS NOT NULL
     AND NOT COALESCE(m.is_group, false)
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_instances w
        WHERE w.id = m.instance_id AND w.reserved_for = 'collections')
), numeros AS (
  SELECT DISTINCT o.organization_id, o.normalized_phone FROM orfas o
), ambiguos AS (
  SELECT n.organization_id, n.normalized_phone, array_agg(c.lead_id) AS candidatos
    FROM numeros n
   CROSS JOIN LATERAL private.leads_vivos_do_numero(n.organization_id, n.normalized_phone) AS c(lead_id)
   GROUP BY n.organization_id, n.normalized_phone
  HAVING count(*) > 1
), elegiveis AS (
  SELECT a.*
    FROM ambiguos a
   WHERE NOT EXISTS (
           SELECT 1 FROM public.deals d
            WHERE d.organization_id = a.organization_id
              AND d.source_lead_id = ANY (a.candidatos)
              AND d.closed_at IS NULL
              AND d.deleted_at IS NULL)
     AND NOT EXISTS (
           SELECT 1 FROM public.whatsapp_numero_lead_escolhido e
            WHERE e.organization_id = a.organization_id
              AND e.normalized_phone = a.normalized_phone)
)
SELECT o.id, o.organization_id, o.normalized_phone, o.instance_id, o."timestamp",
       anterior.lead_id AS novo_lead_id
  FROM orfas o
  JOIN elegiveis a
    ON a.organization_id = o.organization_id
   AND a.normalized_phone = o.normalized_phone
 CROSS JOIN LATERAL (
   SELECT w.lead_id
     FROM public.whatsapp_messages w
    WHERE w.organization_id = o.organization_id
      AND w.normalized_phone = o.normalized_phone
      AND w.deleted_at IS NULL
      AND w.lead_id IS NOT NULL
      AND w.created_at < o.created_at
    ORDER BY w."timestamp" DESC NULLS LAST, w.created_at DESC, w.id DESC
    LIMIT 1
 ) anterior
 WHERE anterior.lead_id = ANY (a.candidatos);

-- Passo 2: guardas.
DO $$
DECLARE
  v_total   integer;
  v_externo integer;
BEGIN
  SELECT count(*) INTO v_total FROM _backfill_numero_alvo;

  SELECT count(*) INTO v_externo
    FROM _backfill_numero_alvo a
   WHERE private.vinculo_de_lead_tem_efeito_externo(a.organization_id);

  IF v_externo > 0 THEN
    RAISE EXCEPTION 'backfill abortado: % mensagens em org com efeito externo no UPDATE de lead_id', v_externo;
  END IF;

  -- Medido: 1.096. Teto folgado para órfãs que chegarem até o apply da
  -- 20280102000000; acima disso alguém precisa olhar antes.
  IF v_total > 5000 THEN
    RAISE EXCEPTION 'backfill abortado: % mensagens no alvo (esperado ~1.100)', v_total;
  END IF;

  RAISE NOTICE 'backfill numero compartilhado: % mensagens em % conversas',
    v_total, (SELECT count(DISTINCT (organization_id, normalized_phone)) FROM _backfill_numero_alvo);
END
$$;

-- Trilha para o rollback (private: fora da API; sem grant a ninguém).
CREATE TABLE IF NOT EXISTS private.backfill_numero_compartilhado_mensagens (
  message_id uuid PRIMARY KEY,
  lead_id    uuid NOT NULL,
  feito_em   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.backfill_numero_compartilhado_resumos (
  organization_id  uuid NOT NULL,
  instance_id      uuid NOT NULL,
  normalized_phone text NOT NULL,
  lead_id          uuid NOT NULL,
  feito_em         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, instance_id, normalized_phone)
);
ALTER TABLE private.backfill_numero_compartilhado_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.backfill_numero_compartilhado_resumos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.backfill_numero_compartilhado_mensagens FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.backfill_numero_compartilhado_resumos FROM PUBLIC, anon, authenticated, service_role;

-- Passo 3: mensagens. Guarda na query: só quem continua sem lead.
WITH feitas AS (
  UPDATE public.whatsapp_messages m
     SET lead_id = a.novo_lead_id
    FROM _backfill_numero_alvo a
   WHERE m.id = a.id
     AND m.lead_id IS NULL
  RETURNING m.id, m.lead_id
)
INSERT INTO private.backfill_numero_compartilhado_mensagens (message_id, lead_id)
SELECT id, lead_id FROM feitas
ON CONFLICT (message_id) DO NOTHING;

-- Passo 4: resumo da lista do inbox (lead_id fixado no 1º INSERT). Só onde está
-- vazio; recebe o lead da órfã mais recente daquela caixa.
WITH feitos AS (
UPDATE public.whatsapp_conversation_summary s
   SET lead_id = u.novo_lead_id,
       updated_at = now()
  FROM (
    SELECT DISTINCT ON (a.organization_id, a.instance_id, a.normalized_phone)
           a.organization_id, a.instance_id, a.normalized_phone, a.novo_lead_id
      FROM _backfill_numero_alvo a
     WHERE a.instance_id IS NOT NULL
     ORDER BY a.organization_id, a.instance_id, a.normalized_phone,
              a."timestamp" DESC NULLS LAST, a.id DESC
  ) u
 WHERE s.organization_id = u.organization_id
   AND s.instance_id = u.instance_id
   AND s.normalized_phone = u.normalized_phone
   AND s.lead_id IS NULL
RETURNING s.organization_id, s.instance_id, s.normalized_phone, s.lead_id
)
INSERT INTO private.backfill_numero_compartilhado_resumos (organization_id, instance_id, normalized_phone, lead_id)
SELECT organization_id, instance_id, normalized_phone, lead_id FROM feitos
ON CONFLICT (organization_id, instance_id, normalized_phone) DO NOTHING;

COMMIT;
