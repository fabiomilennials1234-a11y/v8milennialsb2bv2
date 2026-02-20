-- Preencher closer_id nos registros de pipe_confirmacao que não têm closer
-- mas cujo lead tem closer_id definido.
-- Isso corrige registros criados automaticamente pelo Pipe WhatsApp
-- que não passavam o closer_id do lead.

UPDATE public.pipe_confirmacao pc
SET closer_id = l.closer_id,
    updated_at = NOW()
FROM public.leads l
WHERE pc.lead_id = l.id
  AND pc.closer_id IS NULL
  AND l.closer_id IS NOT NULL;
