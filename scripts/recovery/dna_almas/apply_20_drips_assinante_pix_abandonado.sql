-- apply_20_drips_assinante_pix_abandonado.sql  (2026-06-29)
-- DNA de Almas — 2 drips que faltavam (stage_changed). Fecha os cenários move-only:
--   * assinante (checkout.success/upgrade/renovacao plano) — boas-vindas (não tinha drip)
--   * pix_abandonado (checkout.abandoned, PIX gerado e não pago) — recuperação (não tinha drip)
-- Voz "Marina do DNA de Almas" (casa F/winback/cobrança). Multi-bolha (5s entre bolhas) + guard
-- in_stage→end antes de cada bloco de envio (não enviar se o lead converteu/saiu no meio).
-- Copy SEM merge-fields arriscados: contrato novo Zuvic NÃO manda primeiro_nome/link_checkout
-- (doc §3.2) e PIX abandonado tem link expirado → abertura sem nome, oferece gerar novo PIX.
-- is_active=true; com whatsapp_instances=0 nada envia até conectar o número. Idempotente por nome.
-- Org DNA = d67ae17a-815d-476d-b3a9-287c7b267997

-- ── A) DNA · Assinante (boas-vindas) — stage_changed to_stage=assinante ──
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Assinante (boas-vindas)',true,'stage_changed',
 '{"to_stage":"assinante","pipe_type":"whatsapp"}'::jsonb,
 $def$
 {
  "edges":[
   {"id":"e1","type":"animated","source":"trigger-1","target":"delay-2","animated":true},
   {"id":"e2","type":"animated","source":"delay-2","target":"cond-3","animated":true},
   {"id":"e3","type":"animated","source":"cond-3","target":"action-4","animated":true,"sourceHandle":"source-true"},
   {"id":"e4","type":"animated","source":"cond-3","target":"end-10","animated":true,"sourceHandle":"source-false"},
   {"id":"e5","type":"animated","source":"action-4","target":"delay-5","animated":true},
   {"id":"e6","type":"animated","source":"delay-5","target":"action-6","animated":true},
   {"id":"e7","type":"animated","source":"action-6","target":"delay-7","animated":true},
   {"id":"e8","type":"animated","source":"delay-7","target":"cond-8","animated":true},
   {"id":"e9","type":"animated","source":"cond-8","target":"action-9","animated":true,"sourceHandle":"source-true"},
   {"id":"e10","type":"animated","source":"cond-8","target":"end-11","animated":true,"sourceHandle":"source-false"}
  ],
  "nodes":[
   {"id":"trigger-1","type":"trigger","measured":{"width":280,"height":62},"position":{"x":400,"y":50},"data":{"type":"trigger","label":"Entrou em Assinante","triggerType":"stage_changed","config":{}}},
   {"id":"delay-2","type":"delay","measured":{"width":280,"height":62},"position":{"x":400,"y":180},"data":{"type":"delay","label":"Aguardar 2 min","unit":"minutes","amount":2}},
   {"id":"cond-3","type":"condition","measured":{"width":280,"height":62},"position":{"x":400,"y":310},"data":{"type":"condition","label":"Ainda assinante?","field":"stage","value":"assinante","operator":"in_stage","conditionMode":"field"}},
   {"id":"action-4","type":"action","measured":{"width":280,"height":62},"position":{"x":260,"y":440},"data":{"type":"action","label":"Enviar WhatsApp","actionType":"send_whatsapp","messageTemplate":"Oi! 🌙 Aqui é a Marina, do DNA de Almas.\n\nQue alegria ter você com a gente — seu acesso já está ativo. ✨"}},
   {"id":"delay-5","type":"delay","measured":{"width":280,"height":62},"position":{"x":260,"y":570},"data":{"type":"delay","label":"Pausa entre bolhas","unit":"seconds","amount":5}},
   {"id":"action-6","type":"action","measured":{"width":280,"height":62},"position":{"x":260,"y":700},"data":{"type":"action","label":"Enviar WhatsApp","actionType":"send_whatsapp","messageTemplate":"Você vai receber no seu e-mail os dados de acesso ao DNA de Almas. Se não chegar em alguns minutos (ou cair no spam), me chama aqui que eu resolvo rapidinho. 💛"}},
   {"id":"delay-7","type":"delay","measured":{"width":280,"height":62},"position":{"x":260,"y":830},"data":{"type":"delay","label":"Aguardar 1 dia","unit":"days","amount":1}},
   {"id":"cond-8","type":"condition","measured":{"width":280,"height":62},"position":{"x":260,"y":960},"data":{"type":"condition","label":"Ainda assinante?","field":"stage","value":"assinante","operator":"in_stage","conditionMode":"field"}},
   {"id":"action-9","type":"action","measured":{"width":280,"height":62},"position":{"x":120,"y":1090},"data":{"type":"action","label":"Enviar WhatsApp","actionType":"send_whatsapp","messageTemplate":"Passando aqui pra saber: já conseguiu explorar seu acesso? 🌙\n\nSe surgiu qualquer dúvida, me conta que eu te ajudo a aproveitar tudo."}},
   {"id":"end-10","type":"end","measured":{"width":280,"height":62},"position":{"x":560,"y":440},"data":{"type":"end","label":"Encerrar (saiu do stage)"}},
   {"id":"end-11","type":"end","measured":{"width":280,"height":62},"position":{"x":420,"y":1090},"data":{"type":"end","label":"Encerrar (saiu do stage)"}}
  ]
 }
 $def$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows
  WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Assinante (boas-vindas)');

-- ── B) DNA · PIX abandonado (recuperação) — stage_changed to_stage=pix_abandonado ──
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · PIX abandonado (recuperação)',true,'stage_changed',
 '{"to_stage":"pix_abandonado","pipe_type":"whatsapp"}'::jsonb,
 $def$
 {
  "edges":[
   {"id":"e1","type":"animated","source":"trigger-1","target":"delay-2","animated":true},
   {"id":"e2","type":"animated","source":"delay-2","target":"cond-3","animated":true},
   {"id":"e3","type":"animated","source":"cond-3","target":"action-4","animated":true,"sourceHandle":"source-true"},
   {"id":"e4","type":"animated","source":"cond-3","target":"end-5","animated":true,"sourceHandle":"source-false"},
   {"id":"e5","type":"animated","source":"action-4","target":"delay-6","animated":true},
   {"id":"e6","type":"animated","source":"delay-6","target":"cond-7","animated":true},
   {"id":"e7","type":"animated","source":"cond-7","target":"action-8","animated":true,"sourceHandle":"source-true"},
   {"id":"e8","type":"animated","source":"cond-7","target":"end-9","animated":true,"sourceHandle":"source-false"}
  ],
  "nodes":[
   {"id":"trigger-1","type":"trigger","measured":{"width":280,"height":62},"position":{"x":400,"y":50},"data":{"type":"trigger","label":"Entrou em PIX abandonado","triggerType":"stage_changed","config":{}}},
   {"id":"delay-2","type":"delay","measured":{"width":280,"height":62},"position":{"x":400,"y":180},"data":{"type":"delay","label":"Aguardar 15 min","unit":"minutes","amount":15}},
   {"id":"cond-3","type":"condition","measured":{"width":280,"height":62},"position":{"x":400,"y":310},"data":{"type":"condition","label":"Ainda PIX abandonado?","field":"stage","value":"pix_abandonado","operator":"in_stage","conditionMode":"field"}},
   {"id":"action-4","type":"action","measured":{"width":280,"height":62},"position":{"x":260,"y":440},"data":{"type":"action","label":"Enviar WhatsApp","actionType":"send_whatsapp","messageTemplate":"Oi! 🌙 Vi que você gerou um PIX aqui no DNA de Almas, mas o pagamento ainda não caiu — e o código costuma expirar rapidinho.\n\nQuer que eu gere um novo PIX pra você finalizar agora? É só me responder. 💛"}},
   {"id":"delay-6","type":"delay","measured":{"width":280,"height":62},"position":{"x":260,"y":570},"data":{"type":"delay","label":"Aguardar 1 dia","unit":"days","amount":1}},
   {"id":"cond-7","type":"condition","measured":{"width":280,"height":62},"position":{"x":260,"y":700},"data":{"type":"condition","label":"Ainda PIX abandonado?","field":"stage","value":"pix_abandonado","operator":"in_stage","conditionMode":"field"}},
   {"id":"action-8","type":"action","measured":{"width":280,"height":62},"position":{"x":120,"y":830},"data":{"type":"action","label":"Enviar WhatsApp","actionType":"send_whatsapp","messageTemplate":"Ainda dá tempo de garantir seu mapa. 🌙\n\nSe quiser, eu te mando um novo link de pagamento agora mesmo — é rápido. Tô por aqui pra te ajudar a concluir."}},
   {"id":"end-5","type":"end","measured":{"width":280,"height":62},"position":{"x":560,"y":440},"data":{"type":"end","label":"Encerrar (saiu do stage)"}},
   {"id":"end-9","type":"end","measured":{"width":280,"height":62},"position":{"x":420,"y":830},"data":{"type":"end","label":"Encerrar (saiu do stage)"}}
  ]
 }
 $def$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows
  WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · PIX abandonado (recuperação)');
