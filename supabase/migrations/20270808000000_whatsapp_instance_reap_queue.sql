-- =============================================================================
-- 20270808000000_whatsapp_instance_reap_queue.sql
--
-- Lápide de Instance WhatsApp (#1475, PRD #1472).
--
-- O problema que isto resolve
-- ---------------------------
-- Apagar uma Instance no CRM não a removia no provider. O caminho da UI é
-- best-effort e, quando falha, loga ORPHAN RISK e apaga a linha de qualquer
-- forma — levando o segredo em CASCADE. Sem o token, a instância órfã fica
-- inalcançável para sempre. Medido: >=23 órfãs confirmadas em runtime_logs.
--
-- E existe um segundo caminho que NENHUM código de aplicação alcança:
-- whatsapp_instances.organization_id é ON DELETE CASCADE contra organizations.
-- Apagar uma org apaga as Instances dela direto no Postgres — nenhum código
-- roda, nenhuma chamada ao provider acontece, nenhum log é escrito. E como o
-- segredo também morre em CASCADE, não sobra evidência: a consulta por segredos
-- órfãos retorna zero. Não há como contar o que foi abandonado.
--
-- Por que trigger e não código
-- ----------------------------
-- Um trigger BEFORE DELETE no Postgres é o único ponto que enxerga TODOS os
-- caminhos: botão da UI, CASCADE de org, SQL manual, migration acidental.
-- Triggers de linha disparam também em delete cascateado.
--
-- Esta migration entrega a EVIDÊNCIA. A remoção efetiva no provider é o
-- coletor (#1476).
--
-- ROLLBACK pareado: rollback/20270808000000_whatsapp_instance_reap_queue.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela de lápide
--
-- organization_id e instance_id SEM FK de propósito, seguindo deleted_leads_log:
-- a lápide precisa sobreviver justamente à remoção da org e da Instance. Uma FK
-- para organizations faria o CASCADE apagar a lápide junto — recriando o buraco
-- que ela existe para tapar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_instance_reap_queue (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid,
  -- UNIQUE porque a lápide é montada por DOIS triggers em ordem não garantida
  -- (ver seção 3): quem chegar primeiro insere, o segundo completa via upsert.
  instance_id          uuid NOT NULL UNIQUE,
  instance_name        text,
  provider             text,
  -- Identificador da instância no provider (whatsapp_instances.instance_id ou
  -- whatsapp_instance_secrets.uazapi_instance_id). Diagnóstico: a autenticação
  -- de DELETE /instance é pelo token, não por id na URL.
  provider_instance_id text,
  -- Segredo em repouso. Justificado apenas porque o token morre em CASCADE e sem
  -- ele a órfã é inalcançável. Protegido por RLS deny-all e purgado pelo coletor
  -- após a confirmação (#1476).
  provider_token       text,
  attempts             integer NOT NULL DEFAULT 0,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  last_error           text,
  confirmed_at         timestamptz,
  gave_up_at           timestamptz,
  gave_up_reason       text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_instance_reap_queue IS
  'Lápide de Instance WhatsApp: preserva o token antes do delete para o coletor '
  'remover a instância no provider. Gravada por trigger, então cobre também o '
  'CASCADE de organizations. Deny-all: só service_role e o trigger DEFINER. #1475';

-- Fila do coletor: só o que está pendente de verdade.
CREATE INDEX IF NOT EXISTS idx_wa_reap_pending
  ON public.whatsapp_instance_reap_queue (next_attempt_at)
  WHERE confirmed_at IS NULL AND gave_up_at IS NULL;

-- Purga por retenção após confirmação (#1476).
CREATE INDEX IF NOT EXISTS idx_wa_reap_confirmed
  ON public.whatsapp_instance_reap_queue (confirmed_at)
  WHERE confirmed_at IS NOT NULL;

-- Inspeção humana: o que o coletor desistiu de remover.
CREATE INDEX IF NOT EXISTS idx_wa_reap_gave_up
  ON public.whatsapp_instance_reap_queue (gave_up_at)
  WHERE gave_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_reap_instance
  ON public.whatsapp_instance_reap_queue (instance_id);

-- ---------------------------------------------------------------------------
-- 2. RLS deny-all
--
-- RLS habilitada com ZERO policies: satisfaz o invariante "toda tabela com
-- organization_id tem RLS" sem abrir leitura para ninguém. O REVOKE explícito é
-- obrigatório porque CREATE TABLE herda privilégios default do schema — foi
-- assim que backups à mão nasceram legíveis por anon.
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_instance_reap_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_instance_reap_queue FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_instance_reap_queue FROM anon;
REVOKE ALL ON TABLE public.whatsapp_instance_reap_queue FROM authenticated;

-- Mesma forma de whatsapp_instance_secrets: acesso só por service_role (e pelo
-- owner). FORCE ROW LEVEL SECURITY é deliberadamente omitido para seguir o
-- padrão da tabela de segredos; postgres e service_role têm BYPASSRLS, então
-- FORCE não somaria proteção e só criaria divergência.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.whatsapp_instance_reap_queue TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Dois triggers, porque a ordem do CASCADE não é garantida
--
-- A primeira versão desta migration tinha UM trigger BEFORE DELETE em
-- whatsapp_instances que lia o token do segredo. Funciona no delete direto da
-- Instance. Falha no CASCADE de organização — e é justamente para esse caminho
-- que a lápide existe.
--
-- Motivo: tanto whatsapp_instances quanto whatsapp_instance_secrets têm FK
-- organization_id → organizations ON DELETE CASCADE. Ao apagar a org, o Postgres
-- cascateia para as DUAS em ordem não especificada. Medido no pgTAP: o segredo
-- morreu primeiro, o trigger da Instance não achou nada e a lápide nasceu sem
-- token — gravada, e inútil.
--
-- Desenho que não depende de ordem: a lápide é chaveada por instance_id (UNIQUE)
-- e montada por upsert. Quem morrer primeiro insere o que sabe; o segundo
-- completa sem sobrescrever o que já foi capturado.
--
-- Consequência assumida: a decisão de desistir sai do trigger. Um trigger não
-- pode concluir "não há credencial", porque a credencial pode chegar no upsert
-- seguinte. Quem decide é o coletor (#1476), que é o componente que sabe o que
-- uma credencial vale.
--
-- Ambas as funções são SECURITY DEFINER: leem/escrevem tabelas deny-all.
-- SET search_path fecha o vetor de resolução de nome.
-- ---------------------------------------------------------------------------

-- 3a. Lado da Instance — metadados (org, nome, provider) -------------------
CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_instance_reap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_token       text;
  v_provider_id text;
BEGIN
  -- Pode não achar nada, se o CASCADE já levou o segredo. Nesse caso o trigger
  -- do segredo é quem gravou (ou vai gravar) o token.
  SELECT s.uazapi_token, s.uazapi_instance_id
    INTO v_token, v_provider_id
    FROM public.whatsapp_instance_secrets s
   WHERE s.instance_id = OLD.id;

  INSERT INTO public.whatsapp_instance_reap_queue (
    organization_id, instance_id, instance_name, provider,
    provider_instance_id, provider_token
  ) VALUES (
    OLD.organization_id, OLD.id, OLD.instance_name, OLD.provider,
    COALESCE(v_provider_id, OLD.instance_id), v_token
  )
  ON CONFLICT (instance_id) DO UPDATE SET
    organization_id      = COALESCE(whatsapp_instance_reap_queue.organization_id,
                                    EXCLUDED.organization_id),
    instance_name        = COALESCE(EXCLUDED.instance_name,
                                    whatsapp_instance_reap_queue.instance_name),
    provider             = COALESCE(EXCLUDED.provider,
                                    whatsapp_instance_reap_queue.provider),
    provider_instance_id = COALESCE(whatsapp_instance_reap_queue.provider_instance_id,
                                    EXCLUDED.provider_instance_id),
    -- Nunca sobrescreve token já capturado com NULL.
    provider_token       = COALESCE(whatsapp_instance_reap_queue.provider_token,
                                    EXCLUDED.provider_token);

  RETURN OLD;
END;
$$;

-- 3b. Lado do segredo — o token, que é a parte insubstituível ---------------
CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_secret_reap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_provider text;
  v_name     text;
BEGIN
  -- Sem token não há nada a preservar: deixa a lápide para o trigger da
  -- Instance, que ainda carrega os metadados.
  IF OLD.uazapi_token IS NULL THEN
    RETURN OLD;
  END IF;

  -- A Instance pode ou não existir ainda, dependendo da ordem do CASCADE.
  SELECT w.provider, w.instance_name
    INTO v_provider, v_name
    FROM public.whatsapp_instances w
   WHERE w.id = OLD.instance_id;

  INSERT INTO public.whatsapp_instance_reap_queue (
    organization_id, instance_id, instance_name, provider,
    provider_instance_id, provider_token
  ) VALUES (
    OLD.organization_id, OLD.instance_id, v_name, v_provider,
    OLD.uazapi_instance_id, OLD.uazapi_token
  )
  ON CONFLICT (instance_id) DO UPDATE SET
    organization_id      = COALESCE(whatsapp_instance_reap_queue.organization_id,
                                    EXCLUDED.organization_id),
    instance_name        = COALESCE(whatsapp_instance_reap_queue.instance_name,
                                    EXCLUDED.instance_name),
    provider             = COALESCE(whatsapp_instance_reap_queue.provider,
                                    EXCLUDED.provider),
    provider_instance_id = COALESCE(EXCLUDED.provider_instance_id,
                                    whatsapp_instance_reap_queue.provider_instance_id),
    provider_token       = COALESCE(EXCLUDED.provider_token,
                                    whatsapp_instance_reap_queue.provider_token);

  RETURN OLD;
END;
$$;

-- CREATE FUNCTION concede EXECUTE a PUBLIC por default, e um DROP+CREATE futuro
-- reintroduz isso. Sem estes REVOKE as funções DEFINER de escrita ficam
-- chamáveis por anon — o invariante de RLS reprova, e com razão.
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_instance_reap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_instance_reap() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_instance_reap() FROM authenticated;

REVOKE ALL ON FUNCTION public.enqueue_whatsapp_secret_reap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_secret_reap() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_secret_reap() FROM authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_instance_reap ON public.whatsapp_instances;
CREATE TRIGGER trg_whatsapp_instance_reap
  BEFORE DELETE ON public.whatsapp_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_whatsapp_instance_reap();

DROP TRIGGER IF EXISTS trg_whatsapp_secret_reap ON public.whatsapp_instance_secrets;
CREATE TRIGGER trg_whatsapp_secret_reap
  BEFORE DELETE ON public.whatsapp_instance_secrets
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_whatsapp_secret_reap();
