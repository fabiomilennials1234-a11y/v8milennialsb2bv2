-- 20270822130000_lead_uf_source_erp.sql
--
-- `leads.uf_source` passa a aceitar 'erp'.
--
-- O vocabulário era `manual | webhook | ddd | ai`, de antes de existir
-- sincronização com ERP. A carga da Café Jurerê tentou gravar a procedência da
-- UF vinda do Toth e bateu no CHECK — 4 clientes novos falharam na criação.
--
-- Por que um valor novo, e não reaproveitar um existente:
--
--   `uf_source` serve para UMA decisão — o trigger `set_uf_from_ddd` só
--   sobrescreve a UF quando ela é nula ou veio de `'ddd'`, porque UF inferida
--   de DDD é palpite e as demais fontes são informação. UF do cadastro do ERP
--   é informação. Gravar `'webhook'` ou `'manual'` daria o comportamento certo
--   pela razão errada, e a tela do mapa (que hoje sinaliza só o `'ddd'`)
--   perderia a chance de distinguir a origem quando alguém precisar.
--
-- É `'erp'` e não `'erp_toth'`: qual ERP já está em `upsell_clients.
-- external_source`, e um CHECK que cresce a cada integrador vira manutenção.
--
-- Só schema (guarda F4): nenhuma linha existente é reescrita.

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_uf_source_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_uf_source_check
  CHECK (uf_source IS NULL OR uf_source = ANY (ARRAY['manual', 'webhook', 'ddd', 'ai', 'erp']));

COMMENT ON COLUMN public.leads.uf_source IS
  'Procedência da UF: manual | webhook | ddd | ai | erp. Só ''ddd'' é palpite — o trigger set_uf_from_ddd não sobrescreve as demais.';
