-- ROLLBACK de 20270801000000_voip_call_log_projection.sql
--
-- Desliga a projeção de `voip_calls` em `call_logs` e devolve
-- `fn_call_log_to_history` ao corpo anterior (`source` fixo em `'manual'`).
--
-- O QUE ESTE ROLLBACK NÃO FAZ, DE PROPÓSITO
-- -----------------------------------------
-- NÃO apaga as linhas de `call_logs` já projetadas, nem as entradas de
-- `lead_history` que elas geraram. São registros de ligações que ACONTECERAM —
-- desligar a fiação não desfaz as chamadas, e apagar histórico de cliente para
-- reverter uma migration é dano maior que o defeito que se está revertendo.
--
-- Se a intenção for mesmo limpar (por exemplo, um mapeamento errado que foi ao
-- ar), a remoção é ato separado e deliberado:
--
--   DELETE FROM public.call_logs WHERE voip_provider = 'torquecalls';
--
-- e as linhas de `lead_history` correspondentes (`action = 'call_logged'`,
-- `source = 'system'`) continuam de pé, porque nada as liga por chave.
--
-- O ÍNDICE ÚNICO TAMBÉM FICA. Ele é a trava que impede chamada duplicada no
-- histórico; derrubá-lo junto com o gatilho abriria espaço para duplicata numa
-- eventual reaplicação parcial. Custa nada mantê-lo e é o que se quer se a
-- migration voltar.

DROP TRIGGER IF EXISTS trg_voip_calls_project_call_log_upd ON public.voip_calls;
DROP TRIGGER IF EXISTS trg_voip_calls_project_call_log_ins ON public.voip_calls;

DROP FUNCTION IF EXISTS public.fn_voip_calls_project_call_log();
DROP FUNCTION IF EXISTS public.fn_voip_project_call_log(uuid);

-- Corpo anterior, byte por byte (origem: 20260602* / estado medido em produção
-- em 2026-08-02 antes desta migration).
CREATE OR REPLACE FUNCTION public.fn_call_log_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    INSERT INTO lead_history (lead_id, organization_id, action, description, source, metadata, created_by)
    VALUES (
      NEW.lead_id,
      NEW.organization_id,
      'call_logged',
      CASE NEW.direction
        WHEN 'outbound' THEN 'Ligação realizada'
        ELSE 'Ligação recebida'
      END || ' — ' || NEW.outcome,
      'manual',
      jsonb_build_object(
        'direction', NEW.direction,
        'outcome', NEW.outcome,
        'duration_seconds', NEW.duration_seconds,
        'phone_number', NEW.phone_number
      ),
      NEW.user_id
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_call_log_to_history()
  FROM PUBLIC, anon, authenticated, service_role;
