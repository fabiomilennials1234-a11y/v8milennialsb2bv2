-- ============================================================================
-- O espelho `leads.pipe_whatsapp` para de congelar quando o Negócio SAI do funil.
--
-- Pré-requisito do passo 5 do L2 (mover em vez de duplicar), e conserto de um
-- defeito que já existe hoje.
--
-- ── O DEFEITO, lido no corpo da função em prod ─────────────────────────────
-- `sync_pipeline_entry_to_lead_pipe_whatsapp` resolve o slug do funil por
-- `NEW.pipeline_id` no ramo INSERT/UPDATE, e só escreve em `leads` quando esse
-- slug é `whatsapp`. Consequência: mover a linha de `pipeline_entries` do funil
-- WhatsApp para outro faz o slug deixar de ser `whatsapp`, a função **não
-- escreve nada**, e `leads.pipe_whatsapp` fica com a última etapa de WhatsApp
-- para sempre.
--
-- Só o ramo DELETE zera a coluna — e a decisão 4 do ADR-0023 troca exatamente
-- esse delete por um move. Ou seja: sem este conserto, o passo 5 introduziria o
-- congelamento em massa.
--
-- ⚠️ O ADR-0023 §10 dizia que "um gatilho zera essa coluna quando o Negócio sai
-- de Oportunidades". Errado, e corrigido lá em 2026-08-03: ele zera no DELETE,
-- não no move. Esta migration faz a frase virar verdade.
--
-- ── POR QUE ISSO IMPORTA AGORA, com número ────────────────────────────────
-- Medido em prod 2026-08-03, em `pipeline_stages`: **81 organizações** têm
-- `whatsapp/agendado → confirmacao/reuniao_marcada` configurado, e outras ~26
-- têm `whatsapp/proposta_enviada → propostas`. Sair do funil WhatsApp não é caso
-- de canto — é o caminho normal de mais de 100 orgs.
--
-- Congelado é pior que vazio, e é por isso que isto é conserto e não polimento.
-- Vazio degrada de boa: etapa ausente não casa regra de kanban e não renderiza
-- variável de template. Congelado MENTE — `{estagio}` segue imprimindo
-- "agendado" depois de o negócio ter ido para Oportunidades, e uma condição de
-- automação comparando etapa casa SEMPRE, contra um estado que não existe mais.
-- (Os leitores do Copilot e dos workflows já foram repontados para
--  `pipeline_entries`; esta migration conserta a coluna para quem ainda a lê.)
--
-- Só schema e corpo de função (guarda F4): nenhuma linha de dado de cliente é
-- lida ou escrita por esta migration. O efeito aparece nas escritas seguintes.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_pipeline_entry_to_lead_pipe_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug_novo  TEXT;
  v_slug_velho TEXT;
BEGIN
  -- Blindagem do bounce, inalterada: sem ela o sync com `custom_pipe_entries`
  -- reentra aqui em profundidade 3.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT pip.slug INTO v_slug_velho
      FROM public.pipelines pip
     WHERE pip.id = OLD.pipeline_id AND pip.type = 'system';

    IF v_slug_velho = 'whatsapp' THEN
      UPDATE public.leads SET pipe_whatsapp = NULL WHERE id = OLD.lead_id;
    END IF;

    RETURN OLD;
  END IF;

  SELECT pip.slug INTO v_slug_novo
    FROM public.pipelines pip
   WHERE pip.id = NEW.pipeline_id AND pip.type = 'system';

  IF v_slug_novo = 'whatsapp' THEN
    -- Entrou, ou andou dentro do funil WhatsApp: espelha a etapa.
    UPDATE public.leads SET pipe_whatsapp = NEW.stage_key WHERE id = NEW.lead_id;
    RETURN NEW;
  END IF;

  -- ── O CONSERTO ────────────────────────────────────────────────────────────
  -- Chegando aqui, o destino NÃO é o funil WhatsApp. Antes a função simplesmente
  -- retornava, e era esse `return` mudo que congelava a coluna. Agora ela olha de
  -- ONDE a linha veio: se veio do WhatsApp, o lead deixou de ter posição lá, e o
  -- espelho tem de esvaziar — a mesma coisa que o ramo DELETE já fazia.
  --
  -- Só no UPDATE: num INSERT não existe OLD, e um card nascendo em outro funil
  -- nunca deveria mexer no espelho do WhatsApp.
  IF TG_OP = 'UPDATE' AND OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
    SELECT pip.slug INTO v_slug_velho
      FROM public.pipelines pip
     WHERE pip.id = OLD.pipeline_id AND pip.type = 'system';

    IF v_slug_velho = 'whatsapp' THEN
      -- `OLD.lead_id`: se o lead da linha mudasse no mesmo UPDATE (não deveria,
      -- mas o gatilho não pode supor), quem perde a posição no WhatsApp é o lead
      -- ANTIGO. Zerar o novo apagaria a etapa de quem nunca saiu de lugar nenhum.
      UPDATE public.leads SET pipe_whatsapp = NULL WHERE id = OLD.lead_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_pipeline_entry_to_lead_pipe_whatsapp() IS
  'Espelha a etapa do funil WhatsApp em `leads.pipe_whatsapp` (coluna legada, dropada em fatia posterior). Escreve ao entrar/andar; ESVAZIA ao sair — por DELETE ou por MOVE (ADR-0023 decisão 4). Antes só o DELETE esvaziava, e o move deixava a coluna congelada na última etapa.';

-- ── Verificação ────────────────────────────────────────────────────────────
--
-- Estrutural, não comportamental — e a distinção é a guarda F4. Provar o
-- comportamento exigiria criar org, lead, funil e card só para movê-los, ou
-- seja, ESCREVER dado numa migration. Isso é justamente o que a guarda proíbe,
-- para que URL errada num push vire erro de schema recuperável em vez de
-- mudança de dado — e o `scripts/db-push-branch.sh` recusaria este arquivo sem
-- `--allow-dml`, com razão.
--
-- A prova de comportamento (mover para fora do WhatsApp esvazia a coluna) vive
-- em `supabase/qa-seed/fatia2-move-espelho.sql` e roda na branch efêmera, que é
-- onde escrever dado é de graça.
DO $$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sync_pipeline_entry_to_lead_pipe_whatsapp';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: a funcao de sync nao existe depois do CREATE OR REPLACE.';
  END IF;

  -- O ramo novo é o que distingue esta versão da anterior: sem ele, sair do
  -- funil por UPDATE volta a ser um `return` mudo.
  IF v_src NOT LIKE '%OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id%' THEN
    RAISE EXCEPTION
      'FAIL: o corpo instalado nao contem o ramo de SAIDA por move — o espelho voltaria a congelar.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_sync_whatsapp_stage_to_lead' AND NOT tgisinternal
       AND tgrelid = 'public.pipeline_entries'::regclass
  ) THEN
    RAISE EXCEPTION 'FAIL: o gatilho sumiu. Funcao sem gatilho nao sincroniza nada.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: funcao substituida com o ramo de saida por move, gatilho no lugar. Comportamento provado em qa-seed/fatia2-move-espelho.sql.';
END$$;

COMMIT;
