-- Venda não fecha mais sem valor — e a trava sai da tela e vai para o banco.
--
-- ── O que está acontecendo hoje, medido em 2026-09-02 ────────────────────
-- 44% das vendas dos últimos 6 meses não têm valor informado: 194 de 439, em
-- 28 organizações. E está PIORANDO — de 9% em junho para 74% em agosto.
--
-- O efeito não é um campo vazio; é um número plausível e errado. O painel
-- divide receita por TODAS as vendas, então o ticket médio sai subestimado:
--
--   Chique Distribuidora   mostra R$   731   real R$ 1.178   (61% de erro)
--   Distetica              mostra R$   199   real R$ 1.196   (501%)
--   Grafica Cauta          mostra R$    38   real R$ 4.632   (12.089%)
--
-- Ninguém desconfia de um número desses. É pior que uma tela quebrada.
--
-- ── Por que a trava que já existe não segura ─────────────────────────────
-- `sale-value-guard.ts` está correta e está instalada em UMA tela
-- (`PipePropostas.tsx`). As pessoas fecham venda em SEIS:
--
--   propostas (tem a guarda) ......... 275 vendas · 51% sem valor
--   whatsapp .......................... 12 · 100%
--   4 funis custom .................... 25 · 100%
--
-- E mesmo a tela guardada vaza metade, porque o card dela também é movido por
-- superfícies compartilhadas — card do lead, painel do negócio, paleta de
-- comandos — que escrevem em `pipeline_entries` sem passar pelo handler.
--
-- 🚨 E o vazamento é de GENTE, não de robô. Isto foi medido porque a hipótese
-- contrária parecia óbvia:
--
--   gente na tela .............. 313 movimentos · 59% sem valor
--   servidor (automação/API) .... 56 movimentos · 14% sem valor
--
-- Guarda de integridade em frontend é guarda que não existe: cada tela nova
-- precisa lembrar de importá-la, e a prova é que a única tela guardada ainda
-- vaza metade. O lugar certo é aqui.
--
-- ── A intenção já estava declarada; faltava execução ─────────────────────
-- `pipeline_stages.requires_sale_value` está TRUE em 121 das 121 etapas de
-- ganho ativas. Alguém disse "exige valor" há tempo e nada obedecia. Esta
-- migration é a parte que obedece.
--
-- ── Só na ENTRADA, nunca na permanência ──────────────────────────────────
-- 🚨 A verificação dispara só quando a etapa MUDA para uma exigente. Verificar
-- em todo UPDATE travaria qualquer edição de um card já vendido — trocar o
-- responsável, mexer numa etiqueta, o toque de `updated_at` de um trigger
-- vizinho. O card ficaria refém de um campo que ninguém está editando.
--
-- ── Rollout por organização, e por que assim ─────────────────────────────
-- Ligar para todos hoje recusaria 59% dos movimentos feitos por pessoas. Em
-- agosto seriam 153 vendas barradas no mesmo dia, em 28 orgs.
--
-- A chave do rollout é o próprio `requires_sale_value`, que já é por org e já
-- está ligado em tudo. Então o rollout é ao contrário: DESLIGA onde ainda não
-- se quer, e religa conforme cada conta for entrando. Sem inventar um segundo
-- lugar para configurar a mesma coisa.
--
-- Primeira onda — quem não sente nada:
--   · 9 orgs com ZERO vazamento nos últimos 6 meses (já preenchem sempre)
--   · 78 orgs com etapa de ganho e nenhuma venda em 6 meses
--
-- Fica DESLIGADO, por ora, em 19 orgs que hoje fecham venda sem valor. Elas
-- precisam de conversa antes de bloqueio — Grafica Cauta fechou 122 vendas
-- informando o valor de UMA; para ela isto seria travar a operação inteira.
--
-- Reaplicar é no-op.

-- ── 1. A trava ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_exige_valor_na_venda()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exige boolean;
  v_valor text;
BEGIN
  -- Só na ENTRADA na etapa. Ver o cabeçalho: verificar na permanência
  -- transformaria qualquer edição de card vendido em erro.
  IF TG_OP = 'UPDATE' AND NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
    RETURN NEW;
  END IF;

  SELECT s.requires_sale_value INTO v_exige
    FROM public.pipeline_stages s
   WHERE s.organization_id = NEW.organization_id
     AND s.stage_key = NEW.stage_key
     AND s.stage_role = 'won'
     AND s.is_active;

  IF NOT COALESCE(v_exige, false) THEN
    RETURN NEW;
  END IF;

  v_valor := NULLIF(btrim(COALESCE(NEW.metadata->>'sale_value', '')), '');

  -- Zero é resposta válida: venda de cortesia, troca, ajuste. O que não pode
  -- é AUSÊNCIA — "não informei" e "informei zero" são coisas diferentes, e
  -- hoje as duas viram o mesmo NULL na conta do ticket médio.
  IF v_valor IS NULL THEN
    RAISE EXCEPTION
      'Informe o valor da venda antes de mover para "%".', NEW.stage_key
      USING ERRCODE = 'check_violation',
            HINT = 'Abra o card e preencha o valor da venda. Se a venda foi sem cobrança, informe 0.';
  END IF;

  IF v_valor !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION
      'O valor da venda ("%") não é um número.', v_valor
      USING ERRCODE = 'check_violation',
            HINT = 'Use apenas números, com ponto como separador decimal.';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_exige_valor_na_venda() IS
  'Recusa a entrada numa etapa de ganho marcada com requires_sale_value quando metadata->>sale_value está ausente. Vale para TODOS os caminhos de escrita — tela, automação, API, importação. Dispara só na mudança de etapa.';

DROP TRIGGER IF EXISTS trg_exige_valor_na_venda ON public.pipeline_entries;
CREATE TRIGGER trg_exige_valor_na_venda
  BEFORE INSERT OR UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_exige_valor_na_venda();

-- ── 2. Rollout: desliga onde ainda não se quer ───────────────────────────
-- Guarda a lista do que foi desligado, para religar org a org depois sem
-- precisar recalcular o critério — e para que a decisão fique auditável em vez
-- de existir só neste comentário.
CREATE TABLE IF NOT EXISTS public.rollout_exige_valor_venda (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  motivo          text        NOT NULL,
  vendas_6m       integer     NOT NULL,
  pct_sem_valor   integer     NOT NULL,
  desligado_em    timestamptz NOT NULL DEFAULT now(),
  religado_em     timestamptz
);

COMMENT ON TABLE public.rollout_exige_valor_venda IS
  'Organizações onde a exigência de valor na venda foi DESLIGADA para rollout gradual. Religar = UPDATE pipeline_stages SET requires_sale_value = true nas etapas won da org, e marcar religado_em aqui.';

ALTER TABLE public.rollout_exige_valor_venda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rollout_exige_valor_venda FROM PUBLIC, anon;
GRANT SELECT ON public.rollout_exige_valor_venda TO authenticated;
GRANT ALL    ON public.rollout_exige_valor_venda TO service_role;

DROP POLICY IF EXISTS rollout_exige_valor_master ON public.rollout_exige_valor_venda;
CREATE POLICY rollout_exige_valor_master ON public.rollout_exige_valor_venda
  FOR SELECT TO authenticated
  USING (public.is_master_user());

WITH vendas AS (
  SELECT pe.organization_id,
         count(*) AS total,
         count(*) FILTER (WHERE NULLIF(btrim(COALESCE(pe.metadata->>'sale_value','')),'') IS NULL) AS sem_valor
    FROM public.pipeline_entries pe
    JOIN public.pipeline_stages s
      ON s.organization_id = pe.organization_id
     AND s.stage_key = pe.stage_key
     AND s.stage_role = 'won'
   WHERE pe.stage_changed_at > now() - interval '6 months'
   GROUP BY 1
),
alvo AS (
  SELECT organization_id, total,
         round(100.0 * sem_valor / total)::int AS pct
    FROM vendas
   WHERE sem_valor > 0          -- quem tem ZERO vazamento entra na primeira onda
)
INSERT INTO public.rollout_exige_valor_venda (organization_id, motivo, vendas_6m, pct_sem_valor)
SELECT organization_id,
       CASE WHEN pct > 75 THEN 'nao usa valor de venda — precisa de conversa antes de bloqueio'
            WHEN pct > 25 THEN 'vaza muito — entra em onda posterior'
            ELSE 'vaza pouco — entra na onda seguinte' END,
       total, pct
  FROM alvo
ON CONFLICT (organization_id) DO NOTHING;

UPDATE public.pipeline_stages s
   SET requires_sale_value = false
  FROM public.rollout_exige_valor_venda r
 WHERE s.organization_id = r.organization_id
   AND s.stage_role = 'won'
   AND r.religado_em IS NULL
   AND s.requires_sale_value;

-- ── 3. Guardas ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_trg integer; v_ligadas integer; v_desligadas integer; v_orgs integer;
BEGIN
  SELECT count(*) INTO v_trg FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'pipeline_entries'
     AND t.tgname = 'trg_exige_valor_na_venda' AND NOT t.tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'trigger trg_exige_valor_na_venda nao foi criado';
  END IF;

  -- Nenhuma org da lista de rollout pode ter ficado com a exigência ligada:
  -- seria bloqueio numa conta que a decisão mandou poupar.
  SELECT count(*) INTO v_desligadas
    FROM public.pipeline_stages s
    JOIN public.rollout_exige_valor_venda r ON r.organization_id = s.organization_id
   WHERE s.stage_role = 'won' AND s.requires_sale_value AND r.religado_em IS NULL;
  IF v_desligadas > 0 THEN
    RAISE EXCEPTION '% etapa(s) de org poupada seguem exigindo valor', v_desligadas;
  END IF;

  SELECT count(*) INTO v_ligadas FROM public.pipeline_stages
   WHERE stage_role = 'won' AND is_active AND requires_sale_value;
  SELECT count(*) INTO v_orgs FROM public.rollout_exige_valor_venda WHERE religado_em IS NULL;
  RAISE NOTICE 'exigencia ATIVA em % etapa(s) de ganho; % org(s) poupadas nesta onda',
    v_ligadas, v_orgs;
END $$;
