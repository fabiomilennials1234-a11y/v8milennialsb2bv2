-- 20270312000000_add_leads_origin_detail.sql
--
-- Detalhe textual da origem do lead (ex: "Cadastro LP Meta",
-- "Agendamento Automático Meta"). O enum lead_origin (leads.origin) segmenta
-- por canal; origin_detail carrega o rótulo específico da captação, definido
-- por quem envia o lead (n8n / lead-webhook). A UI já lia lead.origin_detail
-- em LeadSource.tsx — a coluna não existia (erro no .tsc-baseline.json).

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS origin_detail text;

COMMENT ON COLUMN public.leads.origin_detail IS
  'Detalhe textual da origem (ex: "Cadastro LP Meta"). Gravado pelo lead-webhook via payload.origin_detail. Complementa o enum leads.origin.';
