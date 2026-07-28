-- 20270728000001_leads_interest_origin_detail.sql
--
-- Adiciona duas colunas de `leads` que o frontend consome mas que nunca
-- existiram no schema:
--
--   leads.interest      → variável {interesse} de template de mensagem
--                         (src/lib/template-variables.ts:18,57). Selecionada
--                         por ChatComposer e MobileComposerContextual.
--   leads.origin_detail → detalhe livre da origem, renderizado por
--                         LeadSource.tsx:27 via LeadDetailContent.tsx:99.
--
-- Ambas nullable e sem default: são campos opcionais de preenchimento humano,
-- e ADD COLUMN nullable não reescreve a tabela.
--
-- NÃO adiciona `source` nem `campaign_name`, que o mesmo código também pedia.
-- Esses dois são nomes STALE do view-model `LeadContext`, não colunas:
--   LeadContext.source        → coluna real `leads.origin`
--   LeadContext.campaign_name → coluna real `leads.utm_campaign`
-- Criá-los duplicaria a origem do lead em duas colunas — exatamente a dupla
-- fonte de verdade que o registry `lead_origins` eliminou. O mapeamento passa
-- a ser feito no site da query.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS interest text,
  ADD COLUMN IF NOT EXISTS origin_detail text;

COMMENT ON COLUMN public.leads.interest IS
  'Interesse declarado do lead (produto/plano). Alimenta a variável {interesse} nos templates de mensagem.';
COMMENT ON COLUMN public.leads.origin_detail IS
  'Detalhe livre da origem — complementa leads.origin (ex.: origin=meta_ads, origin_detail="Campanha Black Friday"). Renderizado em LeadSource.';
