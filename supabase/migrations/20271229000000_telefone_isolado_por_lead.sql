-- 20271229000000_telefone_isolado_por_lead.sql
--
-- Telefone isolado por lead (hotfix Café Jurerê, 09/11).
--
-- Problema: na mesma org um número só pode ser o principal de UM lead vivo
-- (idx_leads_org_phone_unique). Na Café Jurerê o ERP repete telefone entre
-- clientes (inclusive inativos), e o usuário não consegue trocar o número do
-- cliente A porque o cliente B já o usa. Só a ficha (Contatos) oferecia
-- "Compartilhar"; os demais caminhos de edição param no erro.
--
-- Regra nova, SÓ para org com organizations.feature_flags.telefone_isolado_por_lead
-- = true. Quando um USUÁRIO (auth.uid() presente) troca o telefone principal de
-- um lead, a marca phone_compartilhado DESTE lead é recalculada no mesmo UPDATE:
--   - outro lead vivo NÃO compartilhado já usa o número -> marca (o índice deixa
--     de recusar; o outro lead, o dono, não é tocado);
--   - ninguém mais é dono do número -> desmarca (este lead vira o dono e o índice
--     volta a proteger o número).
-- Por construção um lead marcado sempre tem dono, que é a garantia que
-- tg_leads_phone_compartilhado_guarda exige.
--
-- Fora da regra, de propósito:
--   - INSERT: criar lead com número existente segue recusando. O chat, a API e o
--     import usam essa recusa para ACHAR o lead existente em vez de duplicar.
--   - Sem auth.uid() (ERP Toth, webhook, edge com service_role): como hoje.
--   - UPDATE que já traz phone_compartilhado no SET com valor novo (o "Compartilhar"
--     explícito de salvar_telefones_do_lead): quem chamou decidiu.
--   - Orgs sem a flag: nada muda.
--
-- O gatilho roda depois de leads_normalize_phone_trigger (ordem alfabética dos
-- BEFORE), então NEW.normalized_phone já está calculado. Ele não dispara
-- leads_phone_compartilhado_guarda (BEFORE UPDATE OF phone_compartilhado, coluna
-- fora do SET), por isso grava a mesma trilha em lead_history.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS leads_phone_isolado_por_lead ON public.leads;
--   DROP FUNCTION IF EXISTS public.tg_leads_phone_isolado_por_lead();

CREATE OR REPLACE FUNCTION public.tg_leads_phone_isolado_por_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tem_dono boolean;
BEGIN
  -- Só ação de usuário. ERP, webhook e service_role seguem a regra de sempre.
  IF auth.uid() IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.organizations o
        WHERE o.id = NEW.organization_id
          AND (o.feature_flags ->> 'telefone_isolado_por_lead') = 'true') THEN
    RETURN NEW;
  END IF;

  -- DEFINER: o dono pode ser invisível ao usuário (RLS) e o conflito existe igual.
  v_tem_dono := NEW.normalized_phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.organization_id = NEW.organization_id
       AND l.id <> NEW.id
       AND l.deleted_at IS NULL
       AND NOT l.phone_compartilhado
       AND l.normalized_phone = NEW.normalized_phone);

  IF v_tem_dono = NEW.phone_compartilhado THEN
    RETURN NEW;
  END IF;

  NEW.phone_compartilhado := v_tem_dono;

  INSERT INTO public.lead_history (lead_id, organization_id, action, description, source, metadata, created_by)
  VALUES (
    NEW.id,
    NEW.organization_id,
    CASE WHEN v_tem_dono THEN 'phone_shared' ELSE 'phone_unshared' END,
    CASE WHEN v_tem_dono THEN 'Número compartilhado com outro lead'
         ELSE 'Número deixou de ser compartilhado' END,
    'manual',
    jsonb_build_object('phone', NEW.normalized_phone, 'automatico', 'telefone_isolado_por_lead'),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_leads_phone_isolado_por_lead() IS
  'Org com feature_flags.telefone_isolado_por_lead: na troca de telefone feita por usuário, '
  'recalcula phone_compartilhado DESTE lead (marca se outro lead vivo é dono do número, '
  'desmarca se ninguém é). Só UPDATE com auth.uid(); INSERT, ERP e service_role seguem o índice.';

REVOKE ALL ON FUNCTION public.tg_leads_phone_isolado_por_lead() FROM PUBLIC;

DROP TRIGGER IF EXISTS leads_phone_isolado_por_lead ON public.leads;
CREATE TRIGGER leads_phone_isolado_por_lead
  BEFORE UPDATE OF phone ON public.leads
  FOR EACH ROW
  WHEN (NEW.phone IS DISTINCT FROM OLD.phone
        AND NEW.phone_compartilhado IS NOT DISTINCT FROM OLD.phone_compartilhado)
  EXECUTE FUNCTION public.tg_leads_phone_isolado_por_lead();
