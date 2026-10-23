-- 20271213000000_cobranca_regua.sql
--
-- Cobrança · entrega 2: a régua. Mensagens automáticas por dias de atraso,
-- lembrete de promessa/parcela, mudança automática de etapa, quebra de
-- compromisso, e o número de cobrança isolado do comercial.
-- Desenho: board Miro uXjVHlzya2A= · ADR-0040 (motor próprio, não workflows).
-- ROLLBACK pareado: rollback/20271213000000_cobranca_regua.sql
--
-- ── O QUE ENTRA ─────────────────────────────────────────────────────────────
--   1. whatsapp_instances.reserved_for = 'collections': o número da cobrança.
--      Fonte única do "este número é da cobrança" — quem envia lê a coluna da
--      própria linha, sem consulta extra. A tela da cobrança só escreve nela.
--   2. Isolamento, nos dois sentidos:
--        · o que chega no número da cobrança NÃO liga a lead comercial
--          (gatilho depois do resolve_message_lead_id) e não aciona copilot
--          nem espera de workflow (webhook, na edge);
--        · automação comercial não sai pelo número da cobrança (fallbacks e
--          choke de envio, na edge).
--   3. cobranca_regua (configuração por org), cobranca_regua_passos (o que a
--      régua faz em cada dia) e cobranca_regua_envios (fila + histórico,
--      idempotente por caso/passo/âncora).
--   4. Planejador (SQL, no cron), reserva/conclusão (RPCs de service_role
--      chamadas pela edge `cobranca-regua`), prévia e edição (RPCs da tela).
--   5. Respostas e mensagens humanas do número da cobrança viram eventos do
--      caso; "SAIR"/"PARAR" marca "não contatar".
--
-- ── DECISÕES (CTO, 22/10) ───────────────────────────────────────────────────
--   · Respostas: chat do Torque, isolado (não liga a lead, não aciona IA).
--   · Número próprio (Uazapi conectado na TorqueCRM em 22/10).
--   · Régua nasce DESLIGADA; liga pela tela depois de ver a prévia.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
-- whatsapp_instances e whatsapp_messages são quentes. lock_timeout curto: se o
-- ALTER não pegar o lock em 3 s, a migration falha inteira (transação) em vez
-- de enfileirar escrita do webhook atrás dela. A constraint nova de
-- sent_source entra NOT VALID: as linhas antigas cabem nela por construção
-- (conjunto antigo ⊂ novo) e o VALIDATE leria 6,4 GB à toa.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Número da cobrança
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.whatsapp_instances
  ADD COLUMN reserved_for text CHECK (reserved_for IN ('collections'));

COMMENT ON COLUMN public.whatsapp_instances.reserved_for IS
  'Setor dono exclusivo do número. ''collections'' = número da cobrança: não liga mensagem a lead, não aciona copilot e não serve de fallback para automação comercial (ADR-0040).';

CREATE UNIQUE INDEX whatsapp_instances_um_numero_de_cobranca
  ON public.whatsapp_instances (organization_id) WHERE reserved_for = 'collections';

-- O número da cobrança não tem dono comercial nem copilot. Vários caminhos de
-- envio escolhem o número pelo dono do lead (get_lead_write_instance) ou pelo
-- agente e chamam o fornecedor direto, sem passar pelo choke da edge; fechar o
-- VÍNCULO é o que garante que nenhum deles alcance o devedor. Vale nos dois
-- sentidos: reservar número com vínculo, ou vincular número reservado.
CREATE FUNCTION private.cobranca_proteger_numero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'whatsapp_instances' THEN
    IF NEW.reserved_for IS NOT NULL AND (NEW.owner_team_member_id IS NOT NULL OR NEW.copilot_agent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'O número da cobrança não pode ter dono comercial nem copilot.'
        USING ERRCODE = 'PT409', DETAIL = 'numero_da_cobranca_vinculado';
    END IF;
    IF NEW.reserved_for IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.copilot_agents a WHERE a.whatsapp_instance_id = NEW.id) THEN
      RAISE EXCEPTION 'O número da cobrança não pode atender um copilot.'
        USING ERRCODE = 'PT409', DETAIL = 'numero_da_cobranca_vinculado';
    END IF;
  ELSIF NEW.whatsapp_instance_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.whatsapp_instances w
           WHERE w.id = NEW.whatsapp_instance_id AND w.reserved_for IS NOT NULL) THEN
    RAISE EXCEPTION 'Este número é da cobrança e não pode atender um copilot.'
      USING ERRCODE = 'PT409', DETAIL = 'numero_da_cobranca_vinculado';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER trg_cobranca_proteger_numero
  BEFORE INSERT OR UPDATE OF reserved_for, owner_team_member_id, copilot_agent_id ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION private.cobranca_proteger_numero();
CREATE TRIGGER trg_cobranca_proteger_numero
  BEFORE INSERT OR UPDATE OF whatsapp_instance_id ON public.copilot_agents
  FOR EACH ROW EXECUTE FUNCTION private.cobranca_proteger_numero();
REVOKE ALL ON FUNCTION private.cobranca_proteger_numero() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.whatsapp_messages DROP CONSTRAINT whatsapp_messages_sent_source_check;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_sent_source_check
  CHECK (sent_source = ANY (ARRAY['manual'::text, 'copilot'::text, 'workflow'::text, 'cobranca'::text])) NOT VALID;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Eventos novos do caso
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.cobranca_eventos DROP CONSTRAINT cobranca_eventos_tipo_check;
ALTER TABLE public.cobranca_eventos ADD CONSTRAINT cobranca_eventos_tipo_check CHECK (tipo IN (
  'inadimplente_criado', 'inadimplente_editado', 'inadimplente_arquivado',
  'titulo_incluido', 'titulo_cancelado', 'importado',
  'caso_aberto', 'etapa_alterada', 'responsavel_alterado', 'caso_encerrado',
  'promessa_registrada', 'acordo_registrado', 'compromisso_encerrado',
  'pagamento_registrado', 'contato_registrado', 'nao_contatar_alterado',
  'mensagem_enviada', 'mensagem_recebida', 'envio_falhou'));

-- "Último contato" passa a contar o que é contato de verdade com o devedor:
-- registro manual, resposta dele e mensagem humana pelo chat. A mensagem
-- automática da régua NÃO conta — senão "sem contato há 7 dias" nunca
-- apareceria para quem só recebe robô.
CREATE INDEX cobranca_eventos_contato_real
  ON public.cobranca_eventos (caso_id, created_at DESC)
  WHERE tipo IN ('contato_registrado', 'mensagem_recebida')
     OR (tipo = 'mensagem_enviada' AND dados ->> 'origem' = 'chat');

CREATE OR REPLACE VIEW public.cobranca_inadimplentes_resumo
WITH (security_invoker = true) AS
SELECT i.id,
       i.organization_id,
       i.nome,
       i.documento,
       i.telefone,
       i.email,
       i.contato_nome,
       i.cidade,
       i.origem,
       i.nao_contatar,
       i.created_at,
       c.id              AS caso_id,
       c.etapa_id,
       e.nome            AS etapa_nome,
       e.papel           AS etapa_papel,
       e.cor             AS etapa_cor,
       c.responsavel_id,
       tm.name           AS responsavel_nome,
       c.posicao,
       c.aberto_em,
       c.etapa_desde,
       COALESCE(s.titulos_abertos, 0)::integer        AS titulos_abertos,
       COALESCE(s.saldo_aberto, 0)::numeric(14, 2)    AS saldo_aberto,
       s.vencimento_mais_antigo,
       cp.tipo                                        AS compromisso_tipo,
       cp.proxima_vencimento                          AS compromisso_proxima_vencimento,
       cp.proxima_valor                               AS compromisso_proxima_valor,
       cp.parcelas_total                              AS compromisso_parcelas,
       uc.ultimo_contato_em,
       uc.ultimo_contato_canal,
       ud.desfecho       AS ultimo_desfecho,
       ud.encerrado_em   AS ultimo_encerramento
  FROM public.cobranca_inadimplentes i
  LEFT JOIN public.cobranca_casos c
         ON c.inadimplente_id = i.id AND c.encerrado_em IS NULL
  LEFT JOIN public.cobranca_etapas e ON e.id = c.etapa_id
  LEFT JOIN public.team_members tm ON tm.id = c.responsavel_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE ts.saldo > 0) AS titulos_abertos,
           sum(ts.saldo)                        AS saldo_aberto,
           min(ts.vencimento) FILTER (WHERE ts.saldo > 0) AS vencimento_mais_antigo
      FROM public.cobranca_titulos_saldo ts
     WHERE ts.inadimplente_id = i.id
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT co.tipo,
           (SELECT count(*) FROM public.cobranca_compromisso_parcelas pa
             WHERE pa.compromisso_id = co.id)::integer AS parcelas_total,
           nx.vencimento AS proxima_vencimento,
           nx.valor      AS proxima_valor
      FROM public.cobranca_compromissos co
      LEFT JOIN LATERAL (
        SELECT pa.vencimento, pa.valor
          FROM public.cobranca_compromisso_parcelas pa
         WHERE pa.compromisso_id = co.id
           AND pa.vencimento >= CURRENT_DATE - 1
         ORDER BY pa.vencimento
         LIMIT 1
      ) nx ON true
     WHERE co.caso_id = c.id AND co.status = 'ativo'
  ) cp ON true
  LEFT JOIN LATERAL (
    SELECT ev.created_at AS ultimo_contato_em,
           CASE WHEN ev.tipo = 'contato_registrado' THEN ev.dados ->> 'canal' ELSE 'whatsapp' END
             AS ultimo_contato_canal
      FROM public.cobranca_eventos ev
     WHERE ev.caso_id = c.id
       AND (ev.tipo IN ('contato_registrado', 'mensagem_recebida')
            OR (ev.tipo = 'mensagem_enviada' AND ev.dados ->> 'origem' = 'chat'))
     ORDER BY ev.created_at DESC
     LIMIT 1
  ) uc ON true
  LEFT JOIN LATERAL (
    SELECT cf.desfecho, cf.encerrado_em
      FROM public.cobranca_casos cf
     WHERE cf.inadimplente_id = i.id AND cf.encerrado_em IS NOT NULL AND c.id IS NULL
     ORDER BY cf.encerrado_em DESC
     LIMIT 1
  ) ud ON true
 WHERE i.arquivado_em IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Tabelas da régua
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.cobranca_regua (
  organization_id          uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  ativa                    boolean NOT NULL DEFAULT false,
  -- Chave = dia ISO (1 = segunda … 7 = domingo). Dia ausente = não envia.
  janela                   jsonb NOT NULL DEFAULT
    '{"1":{"inicio":"09:00","fim":"18:00"},"2":{"inicio":"09:00","fim":"18:00"},"3":{"inicio":"09:00","fim":"18:00"},"4":{"inicio":"09:00","fim":"18:00"},"5":{"inicio":"09:00","fim":"18:00"},"6":{"inicio":"09:00","fim":"12:00"}}'::jsonb,
  teto_diario              integer NOT NULL DEFAULT 30 CHECK (teto_diario BETWEEN 1 AND 300),
  intervalo_min_segundos   integer NOT NULL DEFAULT 60 CHECK (intervalo_min_segundos BETWEEN 30 AND 1800),
  intervalo_max_segundos   integer NOT NULL DEFAULT 180 CHECK (intervalo_max_segundos BETWEEN 30 AND 1800),
  -- Devedor que respondeu está conversando com gente: a régua espera.
  pausa_apos_resposta_dias integer NOT NULL DEFAULT 3 CHECK (pausa_apos_resposta_dias BETWEEN 0 AND 30),
  -- Distância mínima entre duas mensagens automáticas ao mesmo devedor.
  intervalo_minimo_dias    integer NOT NULL DEFAULT 2 CHECK (intervalo_minimo_dias BETWEEN 1 AND 30),
  como_pagar               text CHECK (length(como_pagar) <= 600),
  -- Compromisso quebrado volta o caso para cá (null = não move).
  etapa_apos_quebra_id     uuid REFERENCES public.cobranca_etapas(id) ON DELETE SET NULL,
  -- Ritmo do chip: próximo envio da org não sai antes disto.
  proximo_envio_apos       timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid DEFAULT auth.uid(),
  CONSTRAINT cobranca_regua_intervalo CHECK (intervalo_min_segundos <= intervalo_max_segundos)
);

CREATE TABLE public.cobranca_regua_passos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- atraso: N dias depois do vencimento mais antigo em aberto.
  -- lembrete_compromisso: N dias ANTES da próxima parcela/promessa (0 = no dia).
  gatilho              text NOT NULL CHECK (gatilho IN ('atraso', 'lembrete_compromisso')),
  dias                 integer NOT NULL,
  mensagem             text CHECK (length(btrim(mensagem)) BETWEEN 1 AND 1000),
  mover_para_etapa_id  uuid REFERENCES public.cobranca_etapas(id) ON DELETE SET NULL,
  ativo                boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobranca_regua_passos_dia_unico UNIQUE (organization_id, gatilho, dias),
  CONSTRAINT cobranca_regua_passos_dias CHECK (
    (gatilho = 'atraso' AND dias BETWEEN 1 AND 365)
    OR (gatilho = 'lembrete_compromisso' AND dias BETWEEN 0 AND 7)),
  CONSTRAINT cobranca_regua_passos_faz_algo CHECK (mensagem IS NOT NULL OR mover_para_etapa_id IS NOT NULL),
  CONSTRAINT cobranca_regua_passos_lembrete CHECK (
    gatilho <> 'lembrete_compromisso' OR (mensagem IS NOT NULL AND mover_para_etapa_id IS NULL))
);

CREATE TABLE public.cobranca_regua_envios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  caso_id             uuid NOT NULL REFERENCES public.cobranca_casos(id) ON DELETE CASCADE,
  inadimplente_id     uuid NOT NULL REFERENCES public.cobranca_inadimplentes(id) ON DELETE CASCADE,
  passo_id            uuid REFERENCES public.cobranca_regua_passos(id) ON DELETE SET NULL,
  -- Cópia do passo: o histórico sobrevive à edição ou remoção dele.
  gatilho             text NOT NULL,
  dias                integer NOT NULL,
  -- Âncora: vencimento mais antigo (atraso) ou vencimento da parcela (lembrete).
  referencia          date NOT NULL,
  status              text NOT NULL CHECK (status IN ('pendente', 'enviando', 'enviado', 'falhou', 'pulado', 'cancelado')),
  motivo              text,
  agendado_para       timestamptz NOT NULL DEFAULT now(),
  tentativas          smallint NOT NULL DEFAULT 0,
  lease_ate           timestamptz,
  telefone            text,
  texto               text,
  provider_message_id text,
  ultimo_erro         text CHECK (length(ultimo_erro) <= 1000),
  enviado_em          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Idempotência: um passo por caso por âncora. Reprocessar o planejador não
  -- duplica, e a mesma mensagem nunca sai duas vezes.
  CONSTRAINT cobranca_regua_envios_uma_vez UNIQUE (caso_id, gatilho, dias, referencia)
);
CREATE INDEX cobranca_regua_envios_fila
  ON public.cobranca_regua_envios (agendado_para) WHERE status IN ('pendente', 'enviando');
CREATE INDEX cobranca_regua_envios_org_data
  ON public.cobranca_regua_envios (organization_id, enviado_em DESC) WHERE status = 'enviado';
CREATE INDEX cobranca_regua_envios_recentes
  ON public.cobranca_regua_envios (organization_id, updated_at DESC);
CREATE INDEX cobranca_regua_envios_caso
  ON public.cobranca_regua_envios (caso_id, created_at DESC);

CREATE TRIGGER trg_cobranca_regua_passos_updated_at BEFORE UPDATE ON public.cobranca_regua_passos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cobranca_regua_envios_updated_at BEFORE UPDATE ON public.cobranca_regua_envios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Leitura por RLS (mesma porta das tabelas da entrega 1); escrita só por RPC.
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cobranca_regua', 'cobranca_regua_passos', 'cobranca_regua_envios'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id IN (SELECT private.cobranca_orgs_visiveis()))',
      t || '_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$do$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Janela de envio (puro: testável sem relógio)
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.cobranca_janela_valida(p_janela jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT jsonb_typeof(p_janela) = 'object'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_each(p_janela) AS d(dia, faixa)
        WHERE d.dia NOT IN ('1', '2', '3', '4', '5', '6', '7')
           OR jsonb_typeof(d.faixa) <> 'object'
           OR COALESCE(d.faixa ->> 'inicio', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR COALESCE(d.faixa ->> 'fim', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR (d.faixa ->> 'inicio') >= (d.faixa ->> 'fim'));
$fn$;

-- Primeiro instante >= p_ts dentro da janela, no fuso da org. NULL = janela vazia.
CREATE FUNCTION private.cobranca_proxima_janela(p_janela jsonb, p_tz text, p_ts timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  v_local  timestamp := p_ts AT TIME ZONE p_tz;
  v_dia    date;
  v_faixa  jsonb;
  v_inicio timestamptz;
  v_fim    timestamptz;
BEGIN
  FOR d IN 0..7 LOOP
    v_dia := v_local::date + d;
    v_faixa := p_janela -> extract(isodow FROM v_dia)::int::text;
    CONTINUE WHEN v_faixa IS NULL;
    v_inicio := (v_dia + (v_faixa ->> 'inicio')::time) AT TIME ZONE p_tz;
    v_fim    := (v_dia + (v_faixa ->> 'fim')::time) AT TIME ZONE p_tz;
    IF p_ts < v_fim THEN
      RETURN greatest(p_ts, v_inicio);
    END IF;
  END LOOP;
  RETURN NULL;
END
$fn$;

CREATE FUNCTION private.cobranca_na_janela(p_janela jsonb, p_tz text, p_ts timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT private.cobranca_proxima_janela(p_janela, p_tz, p_ts) = p_ts;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Semente: configuração e passos do board
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.cobranca_regua_semear(p_org uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_em_cobranca uuid;
  v_intensiva   uuid;
  v_juridico    uuid;
BEGIN
  PERFORM private.cobranca_semear_etapas(p_org);

  SELECT id INTO v_em_cobranca FROM public.cobranca_etapas
   WHERE organization_id = p_org AND papel = 'aberta' AND nome = 'Em cobrança';
  SELECT id INTO v_intensiva FROM public.cobranca_etapas
   WHERE organization_id = p_org AND papel = 'aberta' AND nome = 'Cobrança intensiva';
  SELECT id INTO v_juridico FROM public.cobranca_etapas
   WHERE organization_id = p_org AND papel = 'aberta' AND nome = 'Jurídico';

  INSERT INTO public.cobranca_regua (organization_id, etapa_apos_quebra_id, updated_by)
  VALUES (p_org, v_em_cobranca, NULL)
  ON CONFLICT (organization_id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM public.cobranca_regua_passos WHERE organization_id = p_org) THEN
    RETURN;
  END IF;

  -- Textos dentro do CDC (art. 42): sem exposição, constrangimento ou ameaça.
  -- O primeiro ensina a sair — reduz denúncia de spam, que é o que bane chip.
  INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, mover_para_etapa_id) VALUES
    (p_org, 'atraso', 1,
     E'Olá, {primeiro_nome}! Aqui é da {empresa}. O pagamento de {valor}, com vencimento em {vencimento}, ainda não consta para nós. Se já pagou, pode desconsiderar esta mensagem.\n{como_pagar}\nPara não receber mais estas mensagens, responda SAIR.',
     NULL),
    (p_org, 'atraso', 3,
     E'{primeiro_nome}, tudo bem? Passando para lembrar do valor de {valor} em aberto desde {vencimento}. Se precisar de ajuda para regularizar, é só responder esta mensagem.\n{como_pagar}',
     NULL),
    (p_org, 'atraso', 7,
     E'Olá, {primeiro_nome}. O valor de {valor} segue em aberto há {dias_atraso} dias. Queremos ajudar você a resolver da melhor forma: responda aqui e a nossa equipe fala com você.\n{como_pagar}',
     v_em_cobranca),
    (p_org, 'atraso', 15,
     E'{primeiro_nome}, ainda não identificamos o pagamento de {valor} (vencido em {vencimento}). Podemos combinar uma data ou um parcelamento. Responda esta mensagem para conversarmos.',
     NULL),
    (p_org, 'atraso', 30,
     E'Olá, {primeiro_nome}. O débito de {valor} está em aberto há {dias_atraso} dias. Queremos encontrar com você a melhor forma de regularizar. Responda esta mensagem para falar com a nossa equipe.',
     v_intensiva),
    (p_org, 'lembrete_compromisso', 1,
     E'Olá, {primeiro_nome}! Lembrete: {quando} ({parcela_vencimento}) vence o pagamento de {parcela_valor} que combinamos.\n{como_pagar}',
     NULL);

  IF v_juridico IS NOT NULL THEN
    INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, mover_para_etapa_id)
    VALUES (p_org, 'atraso', 60, NULL, v_juridico);
  END IF;
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Candidatos: o que a régua faria agora (planejador e prévia leem daqui)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Regras de atraso:
--   · só caso aberto, em etapa 'aberta' sem pausa_regua, sem compromisso ativo,
--     com saldo, inadimplente não arquivado;
--   · âncora = vencimento mais antigo em aberto; passo = o MAIOR passo ativo
--     com dias <= atraso. Caso que entra com 40 dias recebe só o de 30 — nunca
--     a régua inteira de uma vez;
--   · sem mensagem, sem telefone ou "não contatar" → a linha nasce 'pulado'
--     (marca que o passo passou; a mudança de etapa vale mesmo assim);
--   · respondeu há menos de pausa_apos_resposta_dias, ou recebeu mensagem
--     automática há menos de intervalo_minimo_dias → espera (nenhuma linha).
-- Regras de lembrete:
--   · compromisso ativo, próxima parcela com vencimento >= hoje; passo = o
--     MENOR lembrete com dias >= dias que faltam (só o mais próximo; se o da
--     véspera foi perdido, sai só o do dia).
CREATE FUNCTION private.cobranca_regua_candidatos(p_org uuid, p_agora timestamptz)
RETURNS TABLE (
  caso_id uuid, inadimplente_id uuid, passo_id uuid, gatilho text, dias integer,
  referencia date, status text, motivo text, mover_para uuid
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  WITH cfg AS (
    SELECT r.*, o.timezone,
           (p_agora AT TIME ZONE o.timezone)::date AS hoje
      FROM public.cobranca_regua r
      JOIN public.organizations o ON o.id = r.organization_id
     WHERE r.organization_id = p_org
  ), casos AS (
    SELECT c.id AS caso_id, c.inadimplente_id, e.posicao AS etapa_posicao, e.papel, e.pausa_regua,
           i.telefone, i.nao_contatar, s.venc, COALESCE(s.saldo, 0) AS saldo,
           EXISTS (SELECT 1 FROM public.cobranca_compromissos co
                    WHERE co.caso_id = c.id AND co.status = 'ativo') AS tem_compromisso,
           EXISTS (SELECT 1 FROM public.cobranca_eventos ev
                    WHERE ev.caso_id = c.id AND ev.tipo = 'mensagem_recebida'
                      AND ev.created_at > p_agora - make_interval(days => cfg.pausa_apos_resposta_dias)) AS respondeu,
           EXISTS (SELECT 1 FROM public.cobranca_regua_envios en
                    WHERE en.caso_id = c.id AND en.status IN ('enviado', 'enviando', 'pendente')
                      AND COALESCE(en.enviado_em, en.agendado_para) > p_agora - make_interval(days => cfg.intervalo_minimo_dias)) AS recente
      FROM cfg
      JOIN public.cobranca_casos c ON c.organization_id = cfg.organization_id AND c.encerrado_em IS NULL
      JOIN public.cobranca_etapas e ON e.id = c.etapa_id
      JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id AND i.arquivado_em IS NULL
      LEFT JOIN LATERAL (
        SELECT min(ts.vencimento) FILTER (WHERE ts.saldo > 0) AS venc, sum(ts.saldo) AS saldo
          FROM public.cobranca_titulos_saldo ts
         WHERE ts.inadimplente_id = c.inadimplente_id
      ) s ON true
  ), atraso AS (
    SELECT ca.caso_id, ca.inadimplente_id, p.id AS passo_id, 'atraso'::text AS gatilho, p.dias,
           ca.venc AS referencia,
           CASE WHEN p.mensagem IS NULL THEN 'pulado'
                WHEN ca.telefone IS NULL THEN 'pulado'
                WHEN ca.nao_contatar THEN 'pulado'
                ELSE 'pendente' END AS status,
           CASE WHEN p.mensagem IS NULL THEN 'so_etapa'
                WHEN ca.telefone IS NULL THEN 'sem_telefone'
                WHEN ca.nao_contatar THEN 'nao_contatar' END AS motivo,
           p.mover_para_etapa_id AS mover_para,
           ca.respondeu OR ca.recente AS adiar
      FROM casos ca
      CROSS JOIN cfg
      CROSS JOIN LATERAL (
        SELECT p.* FROM public.cobranca_regua_passos p
         WHERE p.organization_id = cfg.organization_id AND p.ativo AND p.gatilho = 'atraso'
           AND p.dias <= cfg.hoje - ca.venc
         ORDER BY p.dias DESC
         LIMIT 1
      ) p
     WHERE ca.papel = 'aberta' AND NOT ca.pausa_regua AND NOT ca.tem_compromisso
       AND ca.saldo > 0 AND ca.venc IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.cobranca_regua_envios en
          WHERE en.caso_id = ca.caso_id AND en.gatilho = 'atraso'
            AND en.dias = p.dias AND en.referencia = ca.venc)
  ), lembrete AS (
    SELECT ca.caso_id, ca.inadimplente_id, p.id AS passo_id, 'lembrete_compromisso'::text AS gatilho, p.dias,
           pa.vencimento AS referencia,
           CASE WHEN ca.telefone IS NULL OR ca.nao_contatar THEN 'pulado' ELSE 'pendente' END AS status,
           CASE WHEN ca.telefone IS NULL THEN 'sem_telefone'
                WHEN ca.nao_contatar THEN 'nao_contatar' END AS motivo,
           NULL::uuid AS mover_para,
           false AS adiar
      FROM casos ca
      CROSS JOIN cfg
      JOIN public.cobranca_compromissos co ON co.caso_id = ca.caso_id AND co.status = 'ativo'
      CROSS JOIN LATERAL (
        SELECT pa.vencimento FROM public.cobranca_compromisso_parcelas pa
         WHERE pa.compromisso_id = co.id AND pa.vencimento >= cfg.hoje
         ORDER BY pa.vencimento
         LIMIT 1
      ) pa
      CROSS JOIN LATERAL (
        SELECT p.* FROM public.cobranca_regua_passos p
         WHERE p.organization_id = cfg.organization_id AND p.ativo AND p.gatilho = 'lembrete_compromisso'
           AND p.dias >= pa.vencimento - cfg.hoje
         ORDER BY p.dias
         LIMIT 1
      ) p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.cobranca_regua_envios en
        WHERE en.caso_id = ca.caso_id AND en.gatilho = 'lembrete_compromisso'
          AND en.dias = p.dias AND en.referencia = pa.vencimento)
  )
  SELECT caso_id, inadimplente_id, passo_id, gatilho, dias, referencia, status, motivo, mover_para
    FROM (SELECT * FROM atraso UNION ALL SELECT * FROM lembrete) x
   WHERE NOT (x.status = 'pendente' AND x.adiar);
$fn$;

-- Variáveis da mensagem de um envio. A edge e a prévia renderizam com o MESMO
-- conjunto (src/modules/cobranca/lib/regua.ts ↔ _shared/cobranca-regua-mensagem.ts).
CREATE FUNCTION private.cobranca_regua_variaveis(p_caso uuid, p_gatilho text, p_referencia date, p_agora timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  WITH base AS (
    SELECT i.nome, o.name AS empresa, o.timezone, r.como_pagar,
           (p_agora AT TIME ZONE o.timezone)::date AS hoje,
           s.saldo, s.venc, s.titulos
      FROM public.cobranca_casos c
      JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
      JOIN public.organizations o ON o.id = c.organization_id
      LEFT JOIN public.cobranca_regua r ON r.organization_id = c.organization_id
      LEFT JOIN LATERAL (
        SELECT sum(ts.saldo) AS saldo,
               min(ts.vencimento) FILTER (WHERE ts.saldo > 0) AS venc,
               count(*) FILTER (WHERE ts.saldo > 0) AS titulos
          FROM public.cobranca_titulos_saldo ts
         WHERE ts.inadimplente_id = c.inadimplente_id
      ) s ON true
     WHERE c.id = p_caso
  ), parcela AS (
    SELECT pa.vencimento, pa.valor
      FROM public.cobranca_compromissos co
      JOIN public.cobranca_compromisso_parcelas pa ON pa.compromisso_id = co.id
     WHERE co.caso_id = p_caso AND co.status = 'ativo'
       AND p_gatilho = 'lembrete_compromisso' AND pa.vencimento = p_referencia
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'nome',               b.nome,
    'primeiro_nome',      split_part(btrim(b.nome), ' ', 1),
    'empresa',            b.empresa,
    'valor',              COALESCE(b.saldo, 0),
    'vencimento',         b.venc,
    'dias_atraso',        CASE WHEN b.venc IS NULL THEN NULL ELSE b.hoje - b.venc END,
    'titulos',            COALESCE(b.titulos, 0),
    'como_pagar',         COALESCE(b.como_pagar, ''),
    'parcela_valor',      (SELECT valor FROM parcela),
    'parcela_vencimento', (SELECT vencimento FROM parcela),
    'quando',             CASE
                            WHEN (SELECT vencimento FROM parcela) IS NULL THEN NULL
                            WHEN (SELECT vencimento FROM parcela) = b.hoje THEN 'hoje'
                            WHEN (SELECT vencimento FROM parcela) = b.hoje + 1 THEN 'amanhã'
                            ELSE 'em ' || ((SELECT vencimento FROM parcela) - b.hoje) || ' dias'
                          END)
    FROM base b;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Planejador (cron, service_role)
-- ─────────────────────────────────────────────────────────────────────────

-- Org apta a rodar a régua: flag, régua ligada e número de cobrança conectado
-- num provider de chip (o oficial exige template — fora desta entrega).
CREATE FUNCTION private.cobranca_regua_instancia(p_org uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT w.id
    FROM public.whatsapp_instances w
   WHERE w.organization_id = p_org
     AND w.reserved_for = 'collections'
     AND w.provider IN ('uazapi', 'evolution')
     AND w.status IN ('connected', 'open')
   LIMIT 1;
$fn$;

CREATE FUNCTION private.cobranca_regua_mover(p_caso uuid, p_para uuid, p_motivo jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso  public.cobranca_casos%ROWTYPE;
  v_atual public.cobranca_etapas%ROWTYPE;
  v_alvo  public.cobranca_etapas%ROWTYPE;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso AND encerrado_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_atual FROM public.cobranca_etapas WHERE id = v_caso.etapa_id;
  SELECT * INTO v_alvo FROM public.cobranca_etapas
   WHERE id = p_para AND organization_id = v_caso.organization_id AND papel = 'aberta';
  -- Só para a frente, só entre etapas abertas. Mover para trás é decisão humana.
  IF NOT FOUND OR v_alvo.id = v_atual.id THEN RETURN false; END IF;
  IF COALESCE(p_motivo ->> 'motivo', '') <> 'compromisso_quebrado' AND v_alvo.posicao <= v_atual.posicao THEN
    RETURN false;
  END IF;

  UPDATE public.cobranca_casos
     SET etapa_id = v_alvo.id, etapa_desde = now(), updated_at = now(),
         posicao = COALESCE((SELECT max(posicao) FROM public.cobranca_casos
                              WHERE etapa_id = v_alvo.id AND encerrado_em IS NULL), 0) + 1
   WHERE id = p_caso;
  PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso, 'etapa_alterada',
    jsonb_build_object('de', v_atual.id, 'para', v_alvo.id, 'origem', 'regua') || COALESCE(p_motivo, '{}'::jsonb));
  RETURN true;
END
$fn$;

-- Compromisso cuja soma de parcelas vencidas (com 1 dia de tolerância) passou
-- do que foi pago desde que ele nasceu = quebrado. O caso volta para a régua.
CREATE FUNCTION private.cobranca_regua_quebrar_compromissos(p_org uuid, p_hoje date)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r       record;
  v_n     integer := 0;
  v_volta uuid;
BEGIN
  SELECT etapa_apos_quebra_id INTO v_volta FROM public.cobranca_regua WHERE organization_id = p_org;

  FOR r IN
    SELECT co.id, co.caso_id, c.inadimplente_id, d.devido, COALESCE(pg.pago, 0) AS pago
      FROM public.cobranca_compromissos co
      JOIN public.cobranca_casos c ON c.id = co.caso_id AND c.encerrado_em IS NULL
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(pa.valor), 0) AS devido
          FROM public.cobranca_compromisso_parcelas pa
         WHERE pa.compromisso_id = co.id AND pa.vencimento < p_hoje - 1
      ) d
      LEFT JOIN LATERAL (
        SELECT sum(pg.valor) AS pago
          FROM public.cobranca_pagamentos pg
         WHERE pg.caso_id = co.caso_id AND pg.created_at >= co.created_at
      ) pg ON true
     WHERE co.organization_id = p_org AND co.status = 'ativo'
       AND d.devido > 0 AND COALESCE(pg.pago, 0) + 0.005 < d.devido
     FOR UPDATE OF co SKIP LOCKED
  LOOP
    UPDATE public.cobranca_compromissos
       SET status = 'quebrado', encerrado_em = now(), updated_at = now()
     WHERE id = r.id;
    PERFORM private.cobranca_evento(p_org, r.inadimplente_id, r.caso_id, 'compromisso_encerrado',
      jsonb_build_object('status', 'quebrado', 'origem', 'regua', 'devido', r.devido, 'pago', r.pago));
    IF v_volta IS NOT NULL THEN
      PERFORM private.cobranca_regua_mover(r.caso_id, v_volta, '{"motivo":"compromisso_quebrado"}'::jsonb);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

CREATE FUNCTION public.cobranca_regua_planejar(p_agora timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org    record;
  c        record;
  v_novos  integer := 0;
  v_moves  integer := 0;
  v_quebra integer := 0;
  v_quando timestamptz;
BEGIN

  FOR v_org IN
    SELECT r.organization_id, r.janela, o.timezone
      FROM public.cobranca_regua r
      JOIN public.organizations o ON o.id = r.organization_id
     WHERE r.ativa
       AND private.cobranca_habilitada(r.organization_id)
       AND private.cobranca_regua_instancia(r.organization_id) IS NOT NULL
  LOOP
    v_quebra := v_quebra + private.cobranca_regua_quebrar_compromissos(
      v_org.organization_id, (p_agora AT TIME ZONE v_org.timezone)::date);

    v_quando := COALESCE(private.cobranca_proxima_janela(v_org.janela, v_org.timezone, p_agora), p_agora);

    FOR c IN SELECT * FROM private.cobranca_regua_candidatos(v_org.organization_id, p_agora) LOOP
      INSERT INTO public.cobranca_regua_envios
        (organization_id, caso_id, inadimplente_id, passo_id, gatilho, dias, referencia, status, motivo, agendado_para)
      VALUES
        (v_org.organization_id, c.caso_id, c.inadimplente_id, c.passo_id, c.gatilho, c.dias, c.referencia,
         c.status, c.motivo, v_quando)
      ON CONFLICT ON CONSTRAINT cobranca_regua_envios_uma_vez DO NOTHING;
      IF FOUND THEN
        v_novos := v_novos + 1;
        IF c.mover_para IS NOT NULL
           AND private.cobranca_regua_mover(c.caso_id, c.mover_para,
                 jsonb_build_object('motivo', 'passo', 'dias', c.dias)) THEN
          v_moves := v_moves + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('envios_criados', v_novos, 'etapas_movidas', v_moves, 'compromissos_quebrados', v_quebra);
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Reserva e conclusão (edge `cobranca-regua`, service_role)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Uma mensagem por org por chamada (ritmo do chip), dentro da janela, abaixo
-- do teto do dia e depois de proximo_envio_apos. Revalida tudo na hora: o
-- caso pode ter sido pago, ganhado compromisso ou pedido para sair entre o
-- planejamento e o envio.
--
-- 'enviando' com lease vencido NÃO volta para a fila: o envio pode ter saído
-- antes da queda. Na cobrança, perder uma mensagem é melhor que mandar duas.
CREATE FUNCTION public.cobranca_regua_reservar(p_lote integer DEFAULT 10, p_agora timestamptz DEFAULT now())
RETURNS TABLE (
  envio_id uuid, organization_id uuid, instancia_id uuid, telefone text,
  mensagem text, variaveis jsonb
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
#variable_conflict use_column
DECLARE
  v_org    record;
  v_env    public.cobranca_regua_envios%ROWTYPE;
  v_motivo text;
  v_inst   uuid;
  v_tel    text;
  v_msg    text;
  v_perdido record;
  v_n      integer := 0;
BEGIN

  FOR v_perdido IN
    UPDATE public.cobranca_regua_envios en
       SET status = 'falhou', motivo = 'resultado_incerto', lease_ate = NULL,
           ultimo_erro = 'O worker caiu durante o envio; a mensagem pode ou não ter saído.'
     WHERE en.status = 'enviando' AND en.lease_ate < p_agora
     RETURNING en.organization_id AS org, en.inadimplente_id AS inad, en.caso_id AS caso, en.id AS envio
  LOOP
    PERFORM private.cobranca_evento(v_perdido.org, v_perdido.inad, v_perdido.caso, 'envio_falhou',
      jsonb_build_object('envio_id', v_perdido.envio, 'motivo', 'resultado_incerto'));
  END LOOP;

  FOR v_org IN
    SELECT r.organization_id, r.janela, r.teto_diario, r.intervalo_min_segundos, r.intervalo_max_segundos,
           o.timezone
      FROM public.cobranca_regua r
      JOIN public.organizations o ON o.id = r.organization_id
     WHERE r.ativa
       AND (r.proximo_envio_apos IS NULL OR r.proximo_envio_apos <= p_agora)
       AND private.cobranca_habilitada(r.organization_id)
       AND private.cobranca_na_janela(r.janela, o.timezone, p_agora)
       AND EXISTS (SELECT 1 FROM public.cobranca_regua_envios en
                    WHERE en.organization_id = r.organization_id AND en.status = 'pendente'
                      AND en.agendado_para <= p_agora)
     ORDER BY r.proximo_envio_apos NULLS FIRST
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= p_lote;

    v_inst := private.cobranca_regua_instancia(v_org.organization_id);
    CONTINUE WHEN v_inst IS NULL;

    CONTINUE WHEN (SELECT count(*) FROM public.cobranca_regua_envios en
                    WHERE en.organization_id = v_org.organization_id AND en.status = 'enviado'
                      AND (en.enviado_em AT TIME ZONE v_org.timezone)::date
                          = (p_agora AT TIME ZONE v_org.timezone)::date) >= v_org.teto_diario;

    -- Até achar um envio válido desta org (os inválidos viram 'cancelado').
    LOOP
      SELECT * INTO v_env FROM public.cobranca_regua_envios en
       WHERE en.organization_id = v_org.organization_id AND en.status = 'pendente'
         AND en.agendado_para <= p_agora
       -- Mais atrasado primeiro; empate na fila desfeito por chegada e id.
       ORDER BY en.dias DESC, en.agendado_para, en.created_at, en.id
       LIMIT 1
       FOR UPDATE SKIP LOCKED;
      EXIT WHEN NOT FOUND;

      v_motivo := NULL;
      v_tel := NULL;
      SELECT CASE
               WHEN c.encerrado_em IS NOT NULL THEN 'caso_encerrado'
               WHEN i.arquivado_em IS NOT NULL THEN 'arquivado'
               WHEN i.nao_contatar THEN 'nao_contatar'
               WHEN i.telefone IS NULL THEN 'sem_telefone'
               WHEN v_env.gatilho = 'atraso' AND (e.papel <> 'aberta' OR e.pausa_regua) THEN 'etapa_pausada'
               WHEN v_env.gatilho = 'atraso' AND EXISTS (
                      SELECT 1 FROM public.cobranca_compromissos co
                       WHERE co.caso_id = c.id AND co.status = 'ativo') THEN 'compromisso_ativo'
               WHEN v_env.gatilho = 'atraso' AND COALESCE((
                      SELECT min(ts.vencimento) FILTER (WHERE ts.saldo > 0)
                        FROM public.cobranca_titulos_saldo ts
                       WHERE ts.inadimplente_id = c.inadimplente_id), 'infinity'::date) <> v_env.referencia
                    THEN 'divida_mudou'
               WHEN v_env.gatilho = 'lembrete_compromisso' AND NOT EXISTS (
                      SELECT 1 FROM public.cobranca_compromissos co
                        JOIN public.cobranca_compromisso_parcelas pa ON pa.compromisso_id = co.id
                       WHERE co.caso_id = c.id AND co.status = 'ativo' AND pa.vencimento = v_env.referencia)
                    THEN 'compromisso_encerrado'
             END,
             i.telefone
        INTO v_motivo, v_tel
        FROM public.cobranca_casos c
        JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
        JOIN public.cobranca_etapas e ON e.id = c.etapa_id
       WHERE c.id = v_env.caso_id;
      IF NOT FOUND THEN
        v_motivo := 'caso_encerrado';
      END IF;

      v_msg := NULL;
      SELECT p.mensagem INTO v_msg FROM public.cobranca_regua_passos p WHERE p.id = v_env.passo_id;
      IF v_motivo IS NULL AND (v_msg IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.cobranca_regua_passos p WHERE p.id = v_env.passo_id AND p.ativo)) THEN
        v_motivo := 'passo_desligado';
      END IF;

      IF v_motivo IS NOT NULL THEN
        UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = v_motivo WHERE id = v_env.id;
        CONTINUE;
      END IF;

      UPDATE public.cobranca_regua_envios
         SET status = 'enviando', tentativas = tentativas + 1, lease_ate = p_agora + interval '3 minutes',
             telefone = v_tel
       WHERE id = v_env.id;

      UPDATE public.cobranca_regua
         SET proximo_envio_apos = p_agora + make_interval(secs =>
               v_org.intervalo_min_segundos
               + floor(random() * (v_org.intervalo_max_segundos - v_org.intervalo_min_segundos + 1)))
       WHERE organization_id = v_org.organization_id;

      envio_id := v_env.id;
      organization_id := v_org.organization_id;
      instancia_id := v_inst;
      telefone := v_tel;
      mensagem := v_msg;
      variaveis := private.cobranca_regua_variaveis(v_env.caso_id, v_env.gatilho, v_env.referencia, p_agora);
      RETURN NEXT;
      v_n := v_n + 1;
      EXIT;
    END LOOP;
  END LOOP;
END
$fn$;

-- p_resultado: 'enviado' | 'retentar' | 'falhou' | 'sem_whatsapp'
CREATE FUNCTION public.cobranca_regua_concluir(
  p_envio uuid, p_resultado text, p_texto text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL, p_erro text DEFAULT NULL,
  p_agora timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_env public.cobranca_regua_envios%ROWTYPE;
BEGIN
  IF p_resultado NOT IN ('enviado', 'retentar', 'falhou', 'sem_whatsapp') THEN
    RAISE EXCEPTION 'Resultado inválido: %', p_resultado USING ERRCODE = 'PT422';
  END IF;

  SELECT * INTO v_env FROM public.cobranca_regua_envios WHERE id = p_envio FOR UPDATE;
  IF NOT FOUND OR v_env.status <> 'enviando' THEN
    RETURN COALESCE(v_env.status, 'inexistente');
  END IF;

  IF p_resultado = 'enviado' THEN
    UPDATE public.cobranca_regua_envios
       SET status = 'enviado', enviado_em = p_agora, lease_ate = NULL, texto = p_texto,
           provider_message_id = p_provider_message_id, ultimo_erro = NULL
     WHERE id = p_envio;
    PERFORM private.cobranca_evento(v_env.organization_id, v_env.inadimplente_id, v_env.caso_id, 'mensagem_enviada',
      jsonb_build_object('origem', 'regua', 'envio_id', p_envio, 'gatilho', v_env.gatilho,
                         'dias', v_env.dias, 'texto', left(p_texto, 1000)));
    RETURN 'enviado';
  END IF;

  IF p_resultado = 'retentar' AND v_env.tentativas < 3 THEN
    UPDATE public.cobranca_regua_envios
       SET status = 'pendente', lease_ate = NULL, ultimo_erro = left(p_erro, 1000),
           agendado_para = p_agora + make_interval(mins => 5 * (2 ^ (v_env.tentativas - 1))::int)
     WHERE id = p_envio;
    RETURN 'pendente';
  END IF;

  UPDATE public.cobranca_regua_envios
     SET status = 'falhou', lease_ate = NULL, ultimo_erro = left(p_erro, 1000),
         motivo = CASE WHEN p_resultado = 'sem_whatsapp' THEN 'sem_whatsapp' ELSE 'erro_no_envio' END
   WHERE id = p_envio;
  PERFORM private.cobranca_evento(v_env.organization_id, v_env.inadimplente_id, v_env.caso_id, 'envio_falhou',
    jsonb_build_object('envio_id', p_envio,
                       'motivo', CASE WHEN p_resultado = 'sem_whatsapp' THEN 'sem_whatsapp' ELSE 'erro_no_envio' END,
                       'erro', left(p_erro, 300)));
  RETURN 'falhou';
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Número da cobrança no chat: isolamento e eventos
-- ─────────────────────────────────────────────────────────────────────────

-- BEFORE: roda DEPOIS de trg_resolve_message_lead_id (ordem alfabética) e
-- desfaz o vínculo com lead comercial. Também barra vínculo posterior (UPDATE).
CREATE FUNCTION private.cobranca_isolar_mensagem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.instance_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.whatsapp_instances w
                  WHERE w.id = NEW.instance_id AND w.reserved_for = 'collections') THEN
    NEW.lead_id := NULL;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER trg_resolve_message_lead_id_zz_cobranca
  BEFORE INSERT OR UPDATE OF lead_id ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.cobranca_isolar_mensagem();

-- O webhook resolve a instância por esta RPC em todo evento Uazapi. Devolver
-- reserved_for aqui é o que deixa o gate da cobrança custar ZERO ida extra ao
-- PostgREST (contrato F5a, tests/unit/uazapi-ingest-rpc-edge.test.ts). Corpo
-- idêntico ao de prod (md5 conferido em 22/10) + a coluna no fim. Mudar o tipo
-- de retorno exige DROP: o REVOKE/GRANT e o COMMENT voltam logo abaixo.
-- Compatível nos dois sentidos de deploy: o webhook antigo ignora a coluna a
-- mais; o novo, contra a RPC antiga, lê undefined e cai no fail-open.
DROP FUNCTION public.resolve_uazapi_instance(text, text);
CREATE FUNCTION public.resolve_uazapi_instance(
  p_instance_ref text,
  p_token text
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  instance_name text,
  phone_number text,
  provider text,
  via text,
  reserved_for text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_via text;
BEGIN
  -- Guarda: só service_role (mesmo padrão de get_uazapi_credentials).
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_instance_ref IS NOT NULL AND p_instance_ref <> '' THEN
    SELECT array_agg(s.instance_id) INTO v_ids
      FROM public.whatsapp_instance_secrets s
      JOIN public.whatsapp_instances i ON i.id = s.instance_id
     WHERE s.uazapi_instance_id = p_instance_ref;
    IF cardinality(v_ids) = 1 THEN
      v_id := v_ids[1];
      v_via := 'instance_id';
    END IF;
  END IF;

  IF v_id IS NULL AND p_token IS NOT NULL AND p_token <> '' THEN
    SELECT array_agg(s.instance_id) INTO v_ids
      FROM public.whatsapp_instance_secrets s
      JOIN public.whatsapp_instances i ON i.id = s.instance_id
     WHERE s.uazapi_token = p_token;
    IF cardinality(v_ids) = 1 THEN
      v_id := v_ids[1];
      v_via := 'token';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT i.id, i.organization_id, i.instance_name, i.phone_number, i.provider, v_via, i.reserved_for
    FROM public.whatsapp_instances i
   WHERE i.id = v_id;
END;
$function$;

COMMENT ON FUNCTION public.resolve_uazapi_instance(text, text) IS
  'Webhook Uazapi: resolve a instância por uazapi_instance_id (preferido) ou token. '
  'Só service_role. Existe para o token viajar no corpo do POST, nunca na URL.';

REVOKE ALL ON FUNCTION public.resolve_uazapi_instance(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_uazapi_instance(text, text) TO service_role;

-- AFTER: resposta do devedor e mensagem humana pelo chat viram evento do caso.
-- "SAIR"/"PARAR" marca não contatar e cancela o que está na fila. Nunca derruba
-- a gravação da mensagem: qualquer erro aqui vira WARNING.
CREATE FUNCTION private.cobranca_registrar_mensagem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_digitos text;
  v_inad    uuid;
  v_caso    uuid;
  v_nao     boolean;
  v_palavra text;
BEGIN
  IF NEW.instance_id IS NULL OR COALESCE(NEW.is_group, false) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_instances w
                  WHERE w.id = NEW.instance_id AND w.reserved_for = 'collections') THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_digitos := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
    IF v_digitos = '' THEN RETURN NULL; END IF;

    SELECT i.id, c.id, i.nao_contatar INTO v_inad, v_caso, v_nao
      FROM public.cobranca_inadimplentes i
      LEFT JOIN public.cobranca_casos c ON c.inadimplente_id = i.id AND c.encerrado_em IS NULL
     WHERE i.organization_id = NEW.organization_id AND i.arquivado_em IS NULL
       AND i.telefone IS NOT NULL
       AND (i.telefone = v_digitos
            OR (length(v_digitos) >= 10 AND length(i.telefone) >= 10
                AND public.normalize_br_mobile(i.telefone) = public.normalize_br_mobile(v_digitos)))
     ORDER BY (c.id IS NULL), i.created_at DESC
     LIMIT 1;
    IF v_inad IS NULL THEN RETURN NULL; END IF;

    IF NEW.direction = 'incoming' THEN
      PERFORM private.cobranca_evento(NEW.organization_id, v_inad, v_caso, 'mensagem_recebida',
        jsonb_build_object('texto', left(COALESCE(NEW.content, ''), 500), 'tipo', NEW.message_type,
                           'message_id', NEW.message_id));

      v_palavra := upper(regexp_replace(COALESCE(NEW.content, ''), '[^A-Za-z]', '', 'g'));
      IF v_palavra IN ('SAIR', 'PARAR', 'STOP', 'CANCELAR', 'DESCADASTRAR') AND NOT v_nao THEN
        UPDATE public.cobranca_inadimplentes SET nao_contatar = true, updated_at = now() WHERE id = v_inad;
        UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'nao_contatar'
         WHERE inadimplente_id = v_inad AND status = 'pendente';
        PERFORM private.cobranca_evento(NEW.organization_id, v_inad, v_caso, 'nao_contatar_alterado',
          jsonb_build_object('valor', true, 'origem', 'resposta', 'texto', left(NEW.content, 100)));
      END IF;
    ELSIF NEW.direction = 'outgoing' AND COALESCE(NEW.sent_source, '') <> 'cobranca' THEN
      -- O eco do envio da régua pode chegar antes de ela gravar a própria
      -- linha (sent_source ainda 'manual'): envio da régua para este número
      -- há menos de 5 minutos = é ele, não é gente.
      IF NOT EXISTS (
        SELECT 1 FROM public.cobranca_regua_envios en
         WHERE en.inadimplente_id = v_inad AND en.status IN ('enviando', 'enviado')
           AND COALESCE(en.enviado_em, en.updated_at) > now() - interval '5 minutes') THEN -- metric-lint-allow: reconhecimento de eco recente, sem métrica de vendas
        PERFORM private.cobranca_evento(NEW.organization_id, v_inad, v_caso, 'mensagem_enviada',
          jsonb_build_object('origem', 'chat', 'texto', left(COALESCE(NEW.content, ''), 500),
                             'tipo', NEW.message_type, 'autor_membro', NEW.sent_by_team_member_id,
                             'message_id', NEW.message_id));
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[cobranca] mensagem % não virou evento: % %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER trg_cobranca_registrar_mensagem
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.cobranca_registrar_mensagem();

-- ─────────────────────────────────────────────────────────────────────────
-- 10. RPCs da tela
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.cobranca_regua_garantir(p_org uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'view');
  PERFORM private.cobranca_regua_semear(p_org);
END
$fn$;

CREATE FUNCTION public.cobranca_regua_salvar(p_org uuid, p_dados jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_etapa uuid := NULLIF(p_dados ->> 'etapa_apos_quebra_id', '')::uuid;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_regua_semear(p_org);

  IF p_dados ? 'janela' AND NOT private.cobranca_janela_valida(p_dados -> 'janela') THEN
    RAISE EXCEPTION 'Horário de envio inválido: cada dia precisa de início antes do fim (HH:MM).'
      USING ERRCODE = 'PT422', DETAIL = 'janela_invalida';
  END IF;
  IF v_etapa IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cobranca_etapas
        WHERE id = v_etapa AND organization_id = p_org AND papel = 'aberta') THEN
    RAISE EXCEPTION 'Etapa inválida para a volta do compromisso quebrado.'
      USING ERRCODE = 'PT422', DETAIL = 'etapa_invalida';
  END IF;

  BEGIN
    UPDATE public.cobranca_regua SET
      janela                   = CASE WHEN p_dados ? 'janela' THEN p_dados -> 'janela' ELSE janela END,
      teto_diario              = COALESCE((p_dados ->> 'teto_diario')::int, teto_diario),
      intervalo_min_segundos   = COALESCE((p_dados ->> 'intervalo_min_segundos')::int, intervalo_min_segundos),
      intervalo_max_segundos   = COALESCE((p_dados ->> 'intervalo_max_segundos')::int, intervalo_max_segundos),
      pausa_apos_resposta_dias = COALESCE((p_dados ->> 'pausa_apos_resposta_dias')::int, pausa_apos_resposta_dias),
      intervalo_minimo_dias    = COALESCE((p_dados ->> 'intervalo_minimo_dias')::int, intervalo_minimo_dias),
      como_pagar               = CASE WHEN p_dados ? 'como_pagar'
                                      THEN NULLIF(btrim(p_dados ->> 'como_pagar'), '') ELSE como_pagar END,
      etapa_apos_quebra_id     = CASE WHEN p_dados ? 'etapa_apos_quebra_id' THEN v_etapa ELSE etapa_apos_quebra_id END,
      updated_at = now(), updated_by = auth.uid()
     WHERE organization_id = p_org;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Valores fora do permitido: teto de 1 a 300 por dia, intervalo de 30 s a 30 min (mínimo até o máximo), pausas de até 30 dias, "como pagar" até 600 caracteres.'
      USING ERRCODE = 'PT422', DETAIL = 'valores_fora_do_permitido';
  END;
END
$fn$;

CREATE FUNCTION public.cobranca_regua_ativar(p_org uuid, p_ativa boolean)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_regua_semear(p_org);

  IF p_ativa THEN
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_instances
                    WHERE organization_id = p_org AND reserved_for = 'collections') THEN
      RAISE EXCEPTION 'Escolha o número da cobrança antes de ligar a régua.'
        USING ERRCODE = 'PT422', DETAIL = 'sem_numero';
    END IF;
    IF private.cobranca_regua_instancia(p_org) IS NULL THEN
      RAISE EXCEPTION 'O número da cobrança está desconectado. Reconecte em Configurações › WhatsApp.'
        USING ERRCODE = 'PT422', DETAIL = 'numero_desconectado';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cobranca_regua_passos
                    WHERE organization_id = p_org AND ativo AND mensagem IS NOT NULL) THEN
      RAISE EXCEPTION 'A régua não tem nenhum passo com mensagem ligado.'
        USING ERRCODE = 'PT422', DETAIL = 'sem_passos';
    END IF;
  ELSE
    -- Desligar esvazia a fila: religar replaneja do zero, sem rajada acumulada.
    UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'regua_desligada'
     WHERE organization_id = p_org AND status = 'pendente';
  END IF;

  UPDATE public.cobranca_regua SET ativa = p_ativa, updated_at = now(), updated_by = auth.uid()
   WHERE organization_id = p_org;
END
$fn$;

-- Reservar um número muda o comportamento do chat e do copilot para ele:
-- exige admin da org (ou master), além de cobranca.edit.
CREATE FUNCTION public.cobranca_regua_definir_numero(p_org uuid, p_instancia uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_inst public.whatsapp_instances%ROWTYPE;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_org_admin(p_org) THEN
    RAISE EXCEPTION 'Só um administrador da organização escolhe o número da cobrança.'
      USING ERRCODE = '42501', DETAIL = 'so_admin';
  END IF;
  PERFORM private.cobranca_regua_semear(p_org);

  IF p_instancia IS NOT NULL THEN
    SELECT * INTO v_inst FROM public.whatsapp_instances WHERE id = p_instancia AND organization_id = p_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Número não encontrado nesta organização.' USING ERRCODE = 'PT404', DETAIL = 'numero_inexistente';
    END IF;
    IF v_inst.provider NOT IN ('uazapi', 'evolution') THEN
      RAISE EXCEPTION 'Por enquanto a régua envia só por número conectado por QR Code. O canal oficial exige templates aprovados e entra numa próxima entrega.'
        USING ERRCODE = 'PT422', DETAIL = 'provider_nao_suportado';
    END IF;
    IF v_inst.copilot_agent_id IS NOT NULL OR EXISTS (
         SELECT 1 FROM public.copilot_agents a WHERE a.whatsapp_instance_id = p_instancia) THEN
      RAISE EXCEPTION 'Este número atende um copilot. Escolha um número exclusivo para a cobrança.'
        USING ERRCODE = 'PT409', DETAIL = 'numero_com_copilot';
    END IF;
    IF v_inst.owner_team_member_id IS NOT NULL THEN
      RAISE EXCEPTION 'Este número tem dono comercial. Tire o dono em Configurações › WhatsApp ou escolha outro número.'
        USING ERRCODE = 'PT409', DETAIL = 'numero_com_dono';
    END IF;
  END IF;

  UPDATE public.whatsapp_instances SET reserved_for = NULL
   WHERE organization_id = p_org AND reserved_for = 'collections'
     AND id IS DISTINCT FROM p_instancia;

  IF p_instancia IS NULL THEN
    UPDATE public.cobranca_regua SET ativa = false, updated_at = now(), updated_by = auth.uid()
     WHERE organization_id = p_org;
    UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'sem_numero'
     WHERE organization_id = p_org AND status = 'pendente';
  ELSE
    UPDATE public.whatsapp_instances SET reserved_for = 'collections' WHERE id = p_instancia;
  END IF;
END
$fn$;

CREATE FUNCTION public.cobranca_regua_passo_salvar(p_org uuid, p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id      uuid;
  v_gatilho text := COALESCE(p_dados ->> 'gatilho', 'atraso');
  v_dias    int;
  v_msg     text := NULLIF(btrim(COALESCE(p_dados ->> 'mensagem', '')), '');
  v_mover   uuid := NULLIF(p_dados ->> 'mover_para_etapa_id', '')::uuid;
  v_ativo   boolean := COALESCE((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_regua_semear(p_org);

  BEGIN
    v_dias := (p_dados ->> 'dias')::int;
  EXCEPTION WHEN OTHERS THEN
    v_dias := NULL;
  END;
  IF v_gatilho NOT IN ('atraso', 'lembrete_compromisso') THEN
    RAISE EXCEPTION 'Tipo de passo inválido.' USING ERRCODE = 'PT422', DETAIL = 'gatilho_invalido';
  END IF;
  IF v_dias IS NULL
     OR (v_gatilho = 'atraso' AND v_dias NOT BETWEEN 1 AND 365)
     OR (v_gatilho = 'lembrete_compromisso' AND v_dias NOT BETWEEN 0 AND 7) THEN
    RAISE EXCEPTION 'Dias fora do permitido: atraso de 1 a 365; lembrete de 0 a 7 dias antes.'
      USING ERRCODE = 'PT422', DETAIL = 'dias_invalidos';
  END IF;
  IF v_msg IS NOT NULL AND length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'A mensagem passa de 1.000 caracteres.' USING ERRCODE = 'PT422', DETAIL = 'mensagem_longa';
  END IF;
  IF v_gatilho = 'lembrete_compromisso' AND (v_msg IS NULL OR v_mover IS NOT NULL) THEN
    RAISE EXCEPTION 'Lembrete precisa de mensagem e não muda etapa.' USING ERRCODE = 'PT422', DETAIL = 'lembrete_invalido';
  END IF;
  IF v_msg IS NULL AND v_mover IS NULL THEN
    RAISE EXCEPTION 'O passo precisa mandar mensagem, mudar a etapa, ou os dois.'
      USING ERRCODE = 'PT422', DETAIL = 'passo_vazio';
  END IF;
  IF v_mover IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cobranca_etapas WHERE id = v_mover AND organization_id = p_org AND papel = 'aberta') THEN
    RAISE EXCEPTION 'Etapa de destino inválida.' USING ERRCODE = 'PT422', DETAIL = 'etapa_invalida';
  END IF;

  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, mover_para_etapa_id, ativo)
      VALUES (p_org, v_gatilho, v_dias, v_msg, v_mover, v_ativo)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.cobranca_regua_passos
         SET gatilho = v_gatilho, dias = v_dias, mensagem = v_msg, mover_para_etapa_id = v_mover, ativo = v_ativo
       WHERE id = p_id AND organization_id = p_org
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'Passo não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'passo_inexistente';
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um passo neste dia.' USING ERRCODE = 'PT409', DETAIL = 'passo_duplicado';
  END;
  RETURN v_id;
END
$fn$;

CREATE FUNCTION public.cobranca_regua_passo_remover(p_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.cobranca_regua_passos WHERE id = p_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Passo não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'passo_inexistente';
  END IF;
  PERFORM private.cobranca_exigir(v_org, 'edit');
  UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'passo_removido'
   WHERE passo_id = p_id AND status = 'pendente';
  DELETE FROM public.cobranca_regua_passos WHERE id = p_id;
END
$fn$;

CREATE FUNCTION public.cobranca_regua_cancelar_envio(p_envio uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.cobranca_regua_envios WHERE id = p_envio;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Envio não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'envio_inexistente';
  END IF;
  PERFORM private.cobranca_exigir(v_org, 'edit');
  UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'cancelado_pela_equipe'
   WHERE id = p_envio AND status = 'pendente';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este envio já saiu ou não está mais na fila.' USING ERRCODE = 'PT409', DETAIL = 'envio_fora_da_fila';
  END IF;
END
$fn$;

-- O que a régua faria agora, sem gravar nada. A tela renderiza as mensagens
-- com as variáveis devolvidas aqui (mesmo renderizador da edge).
CREATE FUNCTION public.cobranca_regua_previa(p_org uuid, p_agora timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_cfg  record;
  v_hoje date;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'view');

  SELECT r.*, o.timezone INTO v_cfg
    FROM public.cobranca_regua r JOIN public.organizations o ON o.id = r.organization_id
   WHERE r.organization_id = p_org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('configurada', false);
  END IF;
  v_hoje := (p_agora AT TIME ZONE v_cfg.timezone)::date;

  RETURN jsonb_build_object(
    'configurada', true,
    'ativa', v_cfg.ativa,
    'numero_pronto', private.cobranca_regua_instancia(p_org) IS NOT NULL,
    'na_janela', private.cobranca_na_janela(v_cfg.janela, v_cfg.timezone, p_agora),
    'proxima_janela', private.cobranca_proxima_janela(v_cfg.janela, v_cfg.timezone, p_agora),
    'teto_diario', v_cfg.teto_diario,
    'enviados_hoje', (SELECT count(*) FROM public.cobranca_regua_envios en
                       WHERE en.organization_id = p_org AND en.status = 'enviado'
                         AND (en.enviado_em AT TIME ZONE v_cfg.timezone)::date = v_hoje),
    'na_fila', (SELECT count(*) FROM public.cobranca_regua_envios en
                 WHERE en.organization_id = p_org AND en.status IN ('pendente', 'enviando')),
    'candidatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'caso_id', c.caso_id, 'inadimplente_id', c.inadimplente_id, 'nome', i.nome,
               'gatilho', c.gatilho, 'dias', c.dias, 'status', c.status, 'motivo', c.motivo,
               'mover_para', c.mover_para, 'mensagem', p.mensagem,
               'variaveis', private.cobranca_regua_variaveis(c.caso_id, c.gatilho, c.referencia, p_agora))
             ORDER BY c.gatilho, c.dias DESC, i.nome)
        FROM private.cobranca_regua_candidatos(p_org, p_agora) c
        JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
        LEFT JOIN public.cobranca_regua_passos p ON p.id = c.passo_id), '[]'::jsonb));
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Grants
-- ─────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION private.cobranca_janela_valida(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_proxima_janela(jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_na_janela(jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_regua_semear(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_regua_candidatos(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_regua_variaveis(uuid, text, date, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_regua_instancia(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_regua_mover(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_regua_quebrar_compromissos(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_isolar_mensagem() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_registrar_mensagem() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cobranca_janela_valida(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_proxima_janela(jsonb, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_na_janela(jsonb, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_regua_semear(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_regua_candidatos(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_regua_variaveis(uuid, text, date, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_regua_instancia(uuid) TO service_role;

-- Worker e cron: só service_role.
REVOKE ALL ON FUNCTION public.cobranca_regua_planejar(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cobranca_regua_reservar(integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cobranca_regua_concluir(uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cobranca_regua_planejar(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.cobranca_regua_reservar(integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.cobranca_regua_concluir(uuid, text, text, text, text, timestamptz) TO service_role;

-- Tela: authenticated (a permissão de verdade está em cobranca_exigir).
DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cobranca_regua_garantir(uuid)',
    'public.cobranca_regua_salvar(uuid, jsonb)',
    'public.cobranca_regua_ativar(uuid, boolean)',
    'public.cobranca_regua_definir_numero(uuid, uuid)',
    'public.cobranca_regua_passo_salvar(uuid, uuid, jsonb)',
    'public.cobranca_regua_passo_remover(uuid)',
    'public.cobranca_regua_cancelar_envio(uuid)',
    'public.cobranca_regua_previa(uuid, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$do$;

-- ─────────────────────────────────────────────────────────────────────────
-- 12. Cron: 8 vezes por hora, nos minutos livres do contrato anti-rajada
--     (tests/unit/cron-escalonamento-contrato.test.ts: pico <= 8 e nunca no
--     minuto de purga pesada). Nenhuma fase */5 ou */10 passa nas duas regras;
--     estes minutos foram medidos com scripts/cron/carga-por-minuto.mjs. Uma
--     mensagem por org por rodada dá até ~70 por dia útil — folga sobre o teto.
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.invoke_cobranca_regua()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  -- Org nenhuma com régua ligada: nem planeja, nem chama.
  IF NOT EXISTS (SELECT 1 FROM public.cobranca_regua WHERE ativa) THEN RETURN; END IF;

  -- Fora do bloco do HTTP: lá, um EXCEPTION desfaria o planejamento junto
  -- (bloco com EXCEPTION é subtransação no plpgsql).
  PERFORM public.cobranca_regua_planejar(now());

  IF NOT EXISTS (SELECT 1 FROM public.cobranca_regua_envios
                  WHERE status = 'pendente' AND agendado_para <= now())
     AND NOT EXISTS (SELECT 1 FROM public.cobranca_regua_envios
                      WHERE status = 'enviando' AND lease_ate < now()) THEN
    RETURN;
  END IF;

  BEGIN
    SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
    SELECT regexp_replace(value, '/functions/v1/.*$', '/functions/v1/cobranca-regua')
      INTO v_url
      FROM public.cron_config
     WHERE value LIKE 'https://%/functions/v1/%'
     ORDER BY key
     LIMIT 1;
    IF v_url IS NULL OR v_url = '' THEN RETURN; END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', COALESCE(v_secret, '')),
      body    := '{}'::jsonb
    );
  EXCEPTION
    -- `invalid_schema_name`: sem pg_net o Postgres falha no SCHEMA antes de
    -- procurar a função, e `undefined_function` não pega isso.
    WHEN invalid_schema_name THEN RETURN;
    WHEN undefined_function  THEN RETURN;
    WHEN undefined_column    THEN RETURN;
    WHEN undefined_table     THEN RETURN;
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_cobranca_regua() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_cobranca_regua() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cobranca-regua')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cobranca-regua');
    PERFORM cron.schedule('cobranca-regua', '1,10,20,25,30,35,40,50 * * * *', $cron$SELECT public.invoke_cobranca_regua();$cron$);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 13. Semente para quem já tem a área
-- ─────────────────────────────────────────────────────────────────────────

DO $do$
DECLARE
  v_org uuid;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations WHERE feature_flags -> 'cobranca' = 'true'::jsonb LOOP
    PERFORM private.cobranca_regua_semear(v_org);
  END LOOP;
END
$do$;

COMMIT;
