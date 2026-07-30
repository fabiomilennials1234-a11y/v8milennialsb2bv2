-- ROLLBACK de 20270730000000_torquecalls_voip_foundation.sql (TorqueCalls S8/S9)
--
-- A migration é aditiva no schema novo e restritiva no schema velho. O rollback,
-- portanto, tem duas metades com riscos diferentes:
--
--   (a) DROP do que nasceu aqui — inofensivo enquanto voice_calls_enabled for
--       false em todas as instâncias (estado de nascimento). Se já houver
--       chamada registrada, o DROP apaga o ledger de voz. Confira antes:
--         SELECT count(*) FROM public.voip_calls;
--
--   (b) VOLTA DO AFROUXAMENTO em consent_records e call_logs. Reverter aqui
--       REABRE: membro desativado escrevendo consentimento, vendedor
--       registrando o próprio opt-in de chamada, revogação sendo desfeita por
--       UPDATE, e call_logs visível para a org inteira sem fronteira de lead.
--       Não reverta a metade (b) por incidente de voz — ela não tem nada a ver
--       com discagem.
--
-- Ordem: cron → dependentes → tabelas → colunas.

-- ---------------------------------------------------------------------------
-- (a) o que nasceu aqui
-- ---------------------------------------------------------------------------

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voip-reap-authorized') THEN
    PERFORM cron.unschedule('voip-reap-authorized');
  END IF;
END
$cron$;

DELETE FROM public.member_feature_permissions
 WHERE feature_key IN ('voip.call.start','voip.call.answer',
                       'voip.call.dial_manual','voip.session.manage');

DELETE FROM public.feature_permissions
 WHERE key IN ('voip.call.start','voip.call.answer',
               'voip.call.dial_manual','voip.session.manage');

DROP FUNCTION IF EXISTS public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_voip_consent_record(uuid, uuid, boolean, text, text, text, text, jsonb);

DROP TABLE IF EXISTS public.voip_call_usage CASCADE;
DROP TABLE IF EXISTS public.voip_calls CASCADE;
DROP TABLE IF EXISTS public.voip_sessions CASCADE;

ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_daily_call_cap_nonneg;
ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS daily_call_cap;
ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS voice_calls_enabled;

-- ---------------------------------------------------------------------------
-- (b) desfaz o endurecimento — só rode se for isso mesmo que você quer
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users see org call logs" ON public.call_logs;
CREATE POLICY "Users see org call logs" ON public.call_logs
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS "Users create call logs" ON public.call_logs;
CREATE POLICY "Users create call logs" ON public.call_logs
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT team_members.organization_id FROM public.team_members
       WHERE team_members.user_id = (SELECT auth.uid())
    )
  );

DROP FUNCTION IF EXISTS public.voip_can_see_call(uuid);

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_outcome_check;
ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_outcome_check
  CHECK (outcome IN ('connected','no_answer','busy','voicemail','wrong_number','callback_scheduled'));

-- user_id volta a NOT NULL só se não houver linha nula (chamada de entrada).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE user_id IS NULL) THEN
    ALTER TABLE public.call_logs ALTER COLUMN user_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'call_logs.user_id mantido NULLABLE: existem linhas sem operador.';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_consent_records_guard ON public.consent_records;
DROP FUNCTION IF EXISTS public.fn_consent_records_guard();

DROP POLICY IF EXISTS "Org members manage consents" ON public.consent_records;
CREATE POLICY "Org members manage consents" ON public.consent_records
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
       WHERE tm.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Org members update consents" ON public.consent_records;
CREATE POLICY "Org members update consents" ON public.consent_records
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
       WHERE tm.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
       WHERE tm.user_id = (SELECT auth.uid())
    )
  );

-- O CHECK só volta a excluir voice_call_whatsapp se não houver linha desse tipo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.consent_records WHERE consent_type = 'voice_call_whatsapp') THEN
    RAISE NOTICE 'consent_records: CHECK mantido com voice_call_whatsapp (existem linhas).';
  ELSE
    ALTER TABLE public.consent_records DROP CONSTRAINT IF EXISTS consent_records_consent_type_check;
    ALTER TABLE public.consent_records
      ADD CONSTRAINT consent_records_consent_type_check
      CHECK (consent_type IN ('marketing_email','marketing_whatsapp','marketing_sms',
                              'data_processing','data_sharing'));
  END IF;
END
$$;
