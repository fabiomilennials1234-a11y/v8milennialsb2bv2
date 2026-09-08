-- Captured from production 2026-09-08. Run only after explicit deployment approval.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.fn_espelho_limpa_projecao(p_deal_id uuid, p_org_id uuid, p_meeting_id uuid, p_meet_link text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_deal_id IS NULL OR p_org_id IS NULL OR p_meeting_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.pipeline_entries pe
     SET metadata = CASE
           -- `meet_link` só sai se for EXATAMENTE o desta reunião. O funil pode
           -- ter um link próprio que a Agenda nunca conheceu.
           WHEN p_meet_link IS NOT NULL AND pe.metadata->>'meet_link' = p_meet_link
             THEN pe.metadata - 'meeting_date' - 'agenda_espelho' - 'meet_link'
           ELSE pe.metadata - 'meeting_date' - 'agenda_espelho'
         END
   WHERE pe.deal_id = p_deal_id
     AND pe.organization_id = p_org_id
     -- A CONDIÇÃO que torna a limpeza segura: só apaga o que este espelho pôs.
     -- Carimbo de outra reunião, ou ausente (data de origem do funil) = não
     -- mexe. `- 'meeting_date'` REMOVE a chave; gravar '' derrubaria
     -- `negocio_projetado`, que faz o cast sem NULLIF.
     AND pe.metadata->'agenda_espelho'->>'meeting_id' = p_meeting_id::text;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_espelha_reuniao_no_funil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- DELETE: some da agenda, some do card — se o carimbo for desta reunião.
  IF TG_OP = 'DELETE' THEN
    IF OLD.event_type IS DISTINCT FROM 'meeting' THEN
      RETURN OLD;
    END IF;
    PERFORM public.fn_espelho_limpa_projecao(
      OLD.deal_id, OLD.organization_id, OLD.id, OLD.meet_link);
    RETURN OLD;
  END IF;

  -- PORTA 1 — só REUNIÃO vira reunião no card. Em prod moram em `meetings`
  -- 22 `call`, 7 `follow_up` e 1 `other`. Sem este filtro, "Retornar contato"
  -- viraria a reunião do negócio.
  IF NEW.event_type IS DISTINCT FROM 'meeting' THEN
    -- …e se ERA reunião e deixou de ser, a projeção antiga não pode ficar órfã.
    IF TG_OP = 'UPDATE' AND OLD.event_type = 'meeting' THEN
      PERFORM public.fn_espelho_limpa_projecao(
        OLD.deal_id, OLD.organization_id, OLD.id, OLD.meet_link);
    END IF;
    RETURN NEW;
  END IF;

  -- TROCA DE NEGÓCIO (inclusive para NULL): limpa o ANTIGO antes de escrever
  -- no novo. A ordem importa — invertida, um negócio novo igual ao antigo
  -- perderia a projeção que acabou de ganhar.
  IF TG_OP = 'UPDATE' AND OLD.deal_id IS DISTINCT FROM NEW.deal_id THEN
    PERFORM public.fn_espelho_limpa_projecao(
      OLD.deal_id, OLD.organization_id, OLD.id, OLD.meet_link);
  END IF;

  -- CANCELADA: a reunião não vale mais, a projeção sai. Hoje nenhuma linha de
  -- prod usa 'cancelled' e a Agenda ainda não expõe o estado — o espelho já
  -- nasce correto para quando expuser.
  IF NEW.status = 'cancelled' THEN
    PERFORM public.fn_espelho_limpa_projecao(
      NEW.deal_id, NEW.organization_id, NEW.id, NEW.meet_link);
    RETURN NEW;
  END IF;

  -- PORTA 2 — sem negócio, não há card onde projetar. Reunião sem negócio
  -- continua sem aparecer no card, que é o comportamento de hoje: zero
  -- regressão. 19,2% das entradas de prod não têm `deal_id`.
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A PROJEÇÃO. Três chaves, e só três.
  --   * `status` = 'completed'/'no_show' cai AQUI de propósito: mantém a data
  --     e só renova o carimbo. O card deve continuar mostrando QUANDO foi a
  --     reunião; o desfecho já vive em `meeting_events` desde o S5.
  --   * `rev` novo a cada escrita — é ele que `fn_capture_meeting_event` lê.
  --   * `meet_link` só entra quando não-nulo: nunca apagar link do funil.
  -- Sem `INSERT`, sem `DELETE`, e sem tocar stage_key/stage_id/is_confirmed/
  -- assigned_to. O `WHERE` por `deal_id` + org alcança no máximo uma linha
  -- (uq_pipeline_entries_deal_id); zero linha sai calado, de propósito —
  -- derrubar o UPDATE da reunião por causa do espelho seria trocar um defeito
  -- por outro.
  UPDATE public.pipeline_entries pe
     SET metadata = COALESCE(pe.metadata, '{}'::jsonb)
                    || jsonb_build_object('meeting_date', NEW.start_at)
                    || CASE
                         WHEN NEW.meet_link IS NOT NULL
                           THEN jsonb_build_object('meet_link', NEW.meet_link)
                         ELSE '{}'::jsonb
                       END
                    || jsonb_build_object(
                         'agenda_espelho',
                         jsonb_build_object(
                           'meeting_id', NEW.id,
                           'rev',        gen_random_uuid()::text,
                           'start_at',   NEW.start_at))
   WHERE pe.deal_id = NEW.deal_id
     AND pe.organization_id = NEW.organization_id;

  RETURN NEW;
END;
$function$
;
DROP TRIGGER trg_meeting_espelha_no_funil ON public.meetings;
CREATE TRIGGER trg_meeting_espelha_no_funil
AFTER INSERT OR DELETE OR UPDATE OF deal_id,lead_id,start_at,meet_link,status,event_type
ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.fn_espelha_reuniao_no_funil();
DROP FUNCTION public.fn_meeting_projection_entry(uuid,uuid,uuid,uuid);
-- Backfill rollback only touches rows still identical to this migration's write.
-- Runtime meeting edits made after deployment are preserved.
UPDATE public.pipeline_entries pe SET metadata=b.old_metadata
FROM backup.meeting_date_recovery_20271017 b
WHERE pe.id=b.entry_id AND pe.organization_id=b.organization_id
  AND pe.metadata=b.projected_metadata;
REVOKE ALL ON FUNCTION public.fn_espelho_limpa_projecao(uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_espelho_limpa_projecao(uuid,uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_espelha_reuniao_no_funil() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_espelha_reuniao_no_funil() TO authenticated;
COMMIT;
