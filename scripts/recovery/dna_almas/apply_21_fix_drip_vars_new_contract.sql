-- apply_21_fix_drip_vars_new_contract.sql  (2026-06-29)
-- DNA de Almas — conserta merge-fields dos drips ANTIGOS que o novo contrato Zuvic não envia.
-- Doc §3.2: Zuvic NÃO manda mais `primeiro_nome` nem `link_checkout` → renderizavam VAZIO
-- ({{custom.primeiro_nome}}→"" e "👉 {{custom.link_checkout}}"→"👉 ").
-- Fix: primeiro_nome→{{nome}} (lead.name, sempre presente). link_checkout: no abandono (B) vira
-- checkout_url (Zuvic envia); nos demais (C/E/winback/G/cobrança) o link não é enviado p/ aquele
-- evento → vira oferta conversacional ("me responde que te mando o link"). codigo_pix/link_pix
-- ficam (enviados no checkout.pending). D (boleto) = drip morto (sem evento) → não tocado.
-- Idempotente (replace de substring exata; re-run = no-op). Org DNA = d67ae17a-...

-- ── 1) GLOBAL: {{custom.primeiro_nome}} → {{nome}} (todos os drips DNA) ──
UPDATE public.workflows
SET definition = replace(definition::text, '{{custom.primeiro_nome}}', '{{nome}}')::jsonb
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND definition::text LIKE '%{{custom.primeiro_nome}}%';

-- ── 2) B (checkout abandonado): link_checkout → checkout_url (abandono ENVIA checkout_url) ──
UPDATE public.workflows
SET definition = replace(definition::text, '{{custom.link_checkout}}', '{{custom.checkout_url}}')::jsonb
WHERE id='a6166c72-c406-48ee-ab8e-1f28b9c37065';

-- ── 3) C (pix_gerado): "reaproveite" usa link_pix; bolha de gerar-novo vira oferta ──
UPDATE public.workflows
SET definition = replace(definition::text,
  'Reaproveite:\n👉 {{custom.link_checkout}}',
  'Reaproveite o mesmo PIX:\n👉 {{custom.link_pix}}')::jsonb
WHERE id='43fd330b-d1e1-42b9-9cf2-12d49ed50766';

UPDATE public.workflows
SET definition = replace(definition::text,
  'Quer que eu gere? Só clica aqui:\n👉 {{custom.link_checkout}}\n\nOu se preferir cartão ou boleto, na tela de pagamento tem a opção.',
  'Quer que eu gere um novo agora? Me responde aqui que eu te mando na hora. 💛\n\nSe preferir cartão ou boleto, também consigo te enviar o link.')::jsonb
WHERE id='43fd330b-d1e1-42b9-9cf2-12d49ed50766';

-- ── 4) E (cartão recusado): tira link quebrado, vira oferta ──
UPDATE public.workflows
SET definition = replace(definition::text,
  '(libera na hora e sem antifraude):\n👉 {{custom.link_checkout}}\n\nSe precisar de ajuda, me chama aqui.',
  '(libera na hora e sem antifraude).\n\nQuer que eu te mande o link pra tentar de novo? Me responde aqui que eu envio na hora. 💛')::jsonb
WHERE id='01beb79b-8b08-4c60-a059-279dfe560300';

-- ── 5) Cancelado (winback): tira link quebrado, vira oferta ──
UPDATE public.workflows
SET definition = replace(definition::text,
  'Se quiser voltar quando fizer sentido, deixo o link aqui:\n👉 {{custom.link_checkout}}\nTe desejo um caminho leve. 🌙',
  'Se quiser voltar quando fizer sentido, me chama aqui que eu te mando o link.\nTe desejo um caminho leve. 🌙')::jsonb
WHERE id='735b109c-e534-4d5f-b6e6-fea0adb09b8d';

-- ── 6) G (reativação frio): tira link quebrado, vira oferta ──
UPDATE public.workflows
SET definition = replace(definition::text,
  'Só queria deixar o link aqui caso um dia faça sentido:\n👉 {{custom.link_checkout}}\n\nTe desejo',
  'Só queria deixar a porta aberta: se um dia fizer sentido, me chama aqui que eu te mando o link.\n\nTe desejo')::jsonb
WHERE id='7d286873-9f61-480b-8ef0-1fe16dd7b8e3';

-- ── 7) Inadimplente (cobrança): tira link quebrado, vira oferta ──
UPDATE public.workflows
SET definition = replace(definition::text,
  'Pra não perder o acesso, é só regularizar por aqui:\n👉 {{custom.link_checkout}}',
  'Pra não perder o acesso, me responde aqui que eu te mando o link pra regularizar agora. 💛')::jsonb
WHERE id='8cbbd7af-70fc-43a0-b563-f35c6895732f';
