#!/usr/bin/env bash
# supabase/tests/run.sh
#
# Runs the pgTAP suites (RLS invariants #638 + metric period bounds #989)
# against a Postgres database that already has the project migrations applied.
#
# In CI this runs after `supabase start` (which applies supabase/migrations/*).
# Locally: `supabase start && supabase/tests/run.sh`.
#
# Order matters:
#   1. rls_invariants_red_fixture.sql  — the TDD RED proof: plants one bad
#      object per invariant and asserts the detectors catch each one. Proves the
#      suite is load-bearing (would fail on a real violation).
#   2. rls_invariants.sql              — the GREEN gate: asserts the real schema
#      has zero violations. This is the actual CI failure condition.
#   3. metric_period_bounds_test.sql   — Metric Period foundation (#989,
#      ADR-0017 §5): organizations.timezone + metric_period_bounds().
#   4. stage_role_test.sql             — Stage Role governance (#990,
#      ADR-0017 §1): pipeline_stages.stage_role + system_stage_role() map.
#   4b. stage_role_money_guard_test.sql — write-gate on won/lost (FIX-4,
#      ADR-0017 §1): only master/org-admin/backend may set money roles.
#   5. pipeline_stage_events_test.sql  — append-only stage ledger (#992,
#      ADR-0017 write model): capture triggers + immutability + RLS.
#   6. sale_events_test.sql            — append-only sale ledger (#993,
#      ADR-0017 §2-4): sale/sale_lost/sale_reversed + Revenue Stream +
#      sold_at tamper-proof + immutability + RLS.
#   6b. sale_events_state_backfill_test.sql — governed CURRENT-STATE sale
#      backfill (U2, ADR-0017 §7): live won/lost entries emit one honest
#      sale/sale_lost anchored on the REAL stage_changed_at (NOT now()),
#      role-resolved (not hardcoded 'vendido'), Revenue Stream by client,
#      value snapshot (malformed → NULL), idempotent vs re-run AND live capture.
#   7.  — commission as projection of the sale
#      ledger (#994, ADR-0017 §6): rate snapshot + reversal mirror +
#      idempotency + projection guard + column grants.
#   8. get_sales_metrics_test.sql      — canonical sales reader (#995,
#      ADR-0017 §2-5,§8): net-of-reversal + stream split + per-closer +
#      unattributed invariant + org-tz period cut + pipeline/member filters +
#      NULL-safe ticket + assert_org_access.
#   9. get_funnel_flow_test.sql        — canonical funnel reader (#996,
#      ADR-0017 §1,§5,§7,§8): cohort-by-entry + monotonic reached-role (skip-safe)
#      + [0,100] rates + NULL-safe conversion_from_prev (#6) + custom-pipeline
#      real numbers (R3) + org-tz cohort boundary + assert_org_access.
#  10. get_ranking_test.sql            — canonical sales leaderboard (#997,
#      ADR-0017 §2-5,§8): single-attribution + net-of-reversal + Σ(member)+
#      unattributed==total + ranking==get_sales_metrics.by_closer + no
#      metric_type bucket (#8) + no type='system' (R3) + rank/share + org-tz +
#      assert_org_access.
#  11. get_commission_ledger_test.sql  — commission as ledger read (#997,
#      ADR-0017 §6,§8): reads only the projection, net-of-reversal, rate
#      snapshot immovable, R5-killer equivalence (ranking member ⟺ ledger line,
#      base==get_ranking.revenue), member filter, org-tz, assert_org_access.
#  12. — produtividade activity-in-period (#1000,
#      ADR-0013 / ADR-0017 §2-5): dimensão `vendido` lê SÓ sale_events, líquida
#      de estorno + atribuição sale_responsible_id única (R5) + sem type='system'
#      (R3) + âncora sold_at (R4); novos por created_at, reuniões por
#      meeting_events; drill do caderno; assert_org_access.
#  13. custom_pipeline_stages_stage_role_test.sql — STAGE_ROLE GOVERNANCE reaches
#      CUSTOM pipelines (U1, ADR-0017 §1 / #990 extension): custom_pipeline_stages
#      gains stage_role (+ suggestion columns + money guard); metric_stage_role
#      dispatches system vs custom via the real join keys (custom_pipeline_stages
#      .pipeline_id + stage_key), so custom-funnel sales finally emit sale_events
#      (R3 killer at the resolver) + won/lost money guard on custom (FIX-4 reuse).
#  15. voip_foundation_test.sql      — fundação TorqueCalls (S8/S9): desenho (C)
#      (kill-switch em whatsapp_instances, sem voip_call_policies), reserva
#      atômica fail-closed, consentimento de voz fora do alcance do membro,
#      fronteira do lead em voip_calls exercida como `authenticated`.
#  16. voip_gate_test.sql           — as DUAS chaves da voz (spec 2026-07-30):
#      teto por organização (`organizations.voice_sessions_cap`, com 0 = sem
#      direito) e o gate comercial `voice_calls` no catálogo `feature_flags` —
#      o que a FK de `organization_features` exige para conceder a voz a UMA
#      organização, e o que faz o override chegar ao gate do servidor via
#      `org_get_features_and_limits`. Estava no repositório sem nunca ter sido
#      registrado aqui: suite que não roda não prova nada.
#
#  17. voip_call_id_provenance_test.sql — proveniência do id de rede da chamada
#      (Fase 1 do contrato TorqueCalls): fn_voip_call_reserve cunha tc_call_id
#      (32 chars [0-9A-F]) na reserva de entrada, devolve a chave no jsonb, e
#      grava na linha — mais anti-regressão dos disjuntores de
#      20270730000003 (a versão vigente, não a da fundação).
#
#  18. voip_sweep_stuck_calls_test.sql — o varredor de chamada sem evento
#      terminal (20270730000007): roda o comando LITERAL de cron.job (não uma
#      cópia reescrita) e prova ringing > 2min recolhido / ringing recente
#      intocado / connected > 2h recolhido / connected recente intocado, e que
#      o operador recolhido volta a reservar via
#      idx_voip_calls_one_live_per_operator.
#
#  19. voip_reserve_inbound_requires_tc_call_id_test.sql — achado I1
#      (20270730000008): atender chamada de entrada sem tc_call_id devolve
#      call_not_answerable SEM gravar operator_user_id (negativa pura); controle
#      positivo com tc_call_id prova que o predicado, e não outra coisa, nega.
#
#  20. voip_webhook_ingest_test.sql — a aplicação do evento assinado da VPS
#      (20270730000010): anti-replay pelo event_jti, ordem por (epoch, seq) —
#      com EPOCH MAIOR + SEQ MENOR ACEITO, que é o restart da VPS —, tabela de
#      transição de voip_sessions, e a corrida com voip-sweep-stuck-calls:
#      `connected` ressuscita linha fechada por `no_terminal_event` (o varredor)
#      e NUNCA por `user_ended` (o operador), e só com o operador livre, porque
#      idx_voip_calls_one_live_per_operator estouraria. Também amarra o conjunto
#      fechado de `code` que o endpoint da T8 roteia por HTTP.
#
#  21. voip_reserve_instance_access_test.sql — quem pode ligar por QUAL número
#      (20270731000001): fn_voip_call_reserve validava sessão, voz e lead, mas
#      nunca se AQUELE usuário podia usar AQUELA instância — e a sessão, que
#      carrega a instância, vem do front. A regra é a MESMA do inbox
#      (useWhatsAppInstancesForUser): sem allowed_members a instância é aberta à
#      org, com lista só a lista, e master/gestor/admin bypassam. Prova os 6
#      casos do brief (aberta / na lista / fora da lista / admin fora / INATIVO
#      na lista / a forma da "Gipp teste", que garante inércia em produção),
#      mais bypass de master e gestor, travessia de tenant, fail-closed, os
#      grants do helper (nem anon nem authenticated executam) e a negativa PURA
#      — sem linha em voip_calls e sem consumir cota.
#
#  22. voip_call_log_projection_test.sql — a chamada de voz vira registro no
#      histórico do lead (20270801000000). Prova as TRÊS portas que fecham
#      chamada, cada uma pelo caminho real: o UPDATE direto de
#      torquecalls-signal rodando como `service_role`, o comando literal
#      extraído de cron.job (varredor) e a RPC fn_voip_apply_vps_event
#      (webhook). Cobre o mapeamento de `outcome` motivo a motivo — inclusive
#      `cancelled` (dois L, da VPS) → `canceled` (um L, do CHECK), que sem
#      tradução derruba a transação do webhook em produção —, duração ancorada
#      em connected_at (nunca authorized_at) e NULA quando não houve conversa, e
#      a idempotência por `voip_call_id`: varredor seguido de correção do
#      webhook, carimbo tardio de connected_at e reentrega de envelope produzem
#      UMA linha, com o mesmo id e sem eco em lead_history.
#
#
#  23. voip_recording_ingest_test.sql — a gravação da chamada chega ao CRM
#      (20270803000000, Gravação S2 #1358). A costura é a REUSADA: os dois
#      eventos novos (`recording-ready`/`recording-failed`) entram pela MESMA
#      `fn_voip_apply_vps_event`, e é por ela que este arquivo os dispara — o
#      atalho pelas funções de estado provaria outra coisa. Prova: os TRÊS
#      estados sem colapsar com a AUSÊNCIA (processando/pronta/falhou vs. NULO
#      de "não gravou"); a reentrega que não duplica nem rebaixa `ready` (o jti
#      NÃO cobre isso — envelope novo, jti novo, quem barra é o estado); o
#      caminho do objeto RECOMPOSTO contra a linha (`path_mismatch` é o vetor
#      cross-tenant do bucket); o carimbo de regime `no_notice`; o anúncio
#      ATRASADO que ainda aplica sem mover marca d'água nem tocar o status; e
#      quem OUVE, exercido como `authenticated` contra `storage.objects` de
#      verdade — vendedor só as próprias, colega nenhuma, admin as da org,
#      forasteiro nenhuma nem com o endereço em mãos, e membro desativado
#      nenhuma (o furo do #1209 nesta roupa).
#
#  24. voip_recording_retention_test.sql — o áudio some em 90 dias, e a busca
#      que falhou é tentada de novo (20270804000000, Gravação S4 #1360). Costura
#      REUSADA: função mais cron, na forma do voip_sweep_stuck_calls_test.
#      A diferença de desenho é IMPOSTA, não escolhida: `storage.objects` tem o
#      gatilho `protect_objects_delete`, que levanta 42501 em qualquer DELETE
#      vindo do SQL — então o expurgo é cron → edge function → Storage API →
#      confirmação, e não um UPDATE agendado.
#      Prova: 91 dias vence e 89 NÃO; a linha de call_logs SOBREVIVE (perde o
#      endereço, mantém desfecho e duração); rodar duas vezes é inofensivo; o
#      OBJETO some do armazenamento e não só a referência — porque
#      `fn_voip_recording_purged` RECUSA enquanto o objeto estiver em
#      storage.objects, que é o que impede a fatia de degradar para
#      "apagar só a referência"; a busca falhada volta para a fila com
#      espaçamento 5/15/45/135 min; o teto de 4 desiste COM CAUSA; a ficha é
#      gasta no CLAIM (worker que morre não vira laço); a barreira de 24 h vale
#      mesmo com ficha sobrando; falha ANUNCIADA pela VPS nunca entra na fila; e
#      `has_function_privilege` nome por nome — anon e authenticated não
#      executam nenhuma das funções novas (o `rls_invariants` NÃO cobre grant de
#      função; medido na S2).
#
#  25. voip_incoming_creates_call_test.sql — a ligação RECEBIDA vira linha no CRM
#      (20270805000000, Entrada E2 #1372, ADR-0027). Costura REUSADA: o evento
#      novo (`incoming`) entra pela MESMA fn_voip_apply_vps_event dos outros
#      cinco, e é por ela que este arquivo o dispara — um INSERT à mão provaria
#      só que a tabela aceita a linha.
#      A asserção que manda é NEGATIVA: `call-status` e `call-ended` sobre
#      chamada inexistente continuam devolvendo `call_not_found` e continuam sem
#      criar nada. Criar na entrada não pode abrir caminho para criar na SAÍDA,
#      onde a criação já tem dono (fn_voip_call_reserve, que cobra cota, checa
#      consentimento e cunha o token).
#      Prova também: `direction`/`status` são LITERAIS (o corpo pode dizer
#      `outbound`/`connected` e a linha diz `inbound`/`ringing`); a linha nasce
#      SEM DONO; o telefone casa nas DUAS formas (JID `555185960716` × cadastro
#      `51985960716`) e também contra os 124 leads que produção guarda COM o DDI;
#      número sem cadastro grava `lead_id` NULO em vez de inventar lead; o
#      casamento é escopado pela org da SESSÃO e respeita `deleted_at` (com
#      CONTROLE POSITIVO — asserção negativa de casamento passa verde por dois
#      motivos, e o mutante do soft-delete sobreviveu até ele existir); `peer`
#      fora de `^[0-9]{8,15}$` recusa LIMPO (`lives_ok`) em vez de derrubar a
#      transação no CHECK, com code PRÓPRIO `peer_unusable` e `ok=true` (202) —
#      recusa esperada NÃO é incidente, e `transition_refused` custaria TRÊS
#      linhas de erro por oferta (RPC + CODE_ACTION do endpoint + `CRM RECUSOU`
#      na VPS ao ver 4xx); o LIMITE da guarda vai declarado junto, porque
#      comprimento não distingue LID de telefone;
#      oferta RETRANSMITIDA não duplica (quem barra é a chave de rede, NÃO o
#      jti); voz desligada REGISTRA assim mesmo; nenhum evento posterior
#      reescreve `peer_phone`; e a projeção do S13 leva a ligação ao histórico do
#      lead. `has_function_privilege` nome por nome — nem anon, nem
#      authenticated, nem service_role executam a função nova.
#
#  25b. voip_can_see_call_dono_canonico_test.sql — a fronteira do lead na leitura
#      de voip_calls olha o dono CANÔNICO (20270915000000). O caso que manda:
#      membro é `sale_responsible_id` e `closer_id` é NULO (26 leads assim em
#      produção em 2026-09-02) — com a função antiga, lendo as legadas
#      sdr_id/closer_id, o dono de verdade não lia a própria ligação. Semeia a
#      divergência com as triggers OFF, restringe leads.view_* nos dois membros
#      para que só a responsabilidade decida, e afirma os grants depois do
#      OR REPLACE (DROP+CREATE devolveria EXECUTE a anon).
#
#  26. metric_negocio_semantica_test.sql — LEAD ≠ NEGÓCIO (SCRUM-311 fatia 9,
#      20270813100000, ADR-0023 `negocio-is-the-funnel-unit`). A asserção que o
#      arquivo existe para fazer: um lead com DOIS negócios abertos devolve
#      "Negócios na etapa" = 2 e "Leads na etapa" = 1. Em produção a mesma
#      medida servia aos dois nomes — 41.025 entradas para 36.073 leads, 12% de
#      erro mudo. (LN3) afirma que os dois números NÃO batem: se voltarem a
#      bater, a fatia foi desfeita.
#      Prova também: a soma da série de `leads_na_etapa` (3) NÃO é o total (2),
#      porque distinct por balde não é aditivo — está afirmado para que ninguém
#      "conserte"; `negocios_abertos` conta ABERTURA na janela, então o negócio
#      fechado depois continua contando; a conversão por negócio divide venda
#      por negócio (mesma unidade nos dois lados); `sale_events.deal_id` existe,
#      é nulável, tem FK e índice e ZERO linhas preenchidas (schema, não dado);
#      o snapshot de 3 argumentos MORREU, senão a conta antiga continuaria a um
#      `CREATE OR REPLACE` de distância; e a RECEITA sobreviveu à reescrita do
#      despachante.
#
#  27. metric_custom_tree_test.sql — MÉTRICA PERSONALIZADA (SCRUM-311 fatia 10 /
#      SCRUM-316..320, 20270813110000, Emenda 1 do ADR-0023). Cobre as três
#      obrigações que a emenda cria, uma por bloco:
#        (1) validar nas DUAS pontas — (WR) exercita o trigger de escrita e (RT)
#            planta uma árvore inválida com o trigger DESLIGADO e prova que o
#            motor a recusa mesmo assim. A linha gravada sobrevive a mudança de
#            validador; um lado só não bastaria.
#        (2) falhar alto — (ER) sete formas de árvore inválida, todas 22023,
#            nenhuma devolvendo null que passe por número.
#        (3) um teste por operador e o teto — (OP) `+ − × ÷` com números
#            exatos, (PF) profundidade 3 aceita e profundidade 4 RECUSADA nas
#            duas pontas.
#      🔴 O bloco que mais importa é (TR), a ARMADILHA DE 100×: o ramo
#      `kind='ratio'` do v1 deriva count/count → percent e MULTIPLICA por 100,
#      enquanto o front só SUFIXA '%'. Na árvore, count ÷ count deriva RATIO e o
#      motor NÃO multiplica — (TR1) afirma 2,5 e não 250. Quem quer percentual
#      escreve `× 100` na própria árvore, e (TR3) prova que sai certo.
#
#  26. organizations_plan_fk_test.sql — o catálogo passa a mandar em
#      `organizations.subscription_plan` (SCRUM-337, 20270811000000). O CHECK de
#      8 literais permitia `basic`, nome que NUNCA existiu em
#      `subscription_plans`: a org passava na validação e depois perdia TODAS as
#      features no `COALESCE(sp.features, '{}')` de
#      `org_get_features_and_limits` — apagão silencioso.
#      Asserções de COMPORTAMENTO, não de estrutura: nenhuma pergunta "existe
#      uma constraint chamada X" (quebra em refactor sem defeito e passaria
#      verde com CHECK e FK vivos ao mesmo tempo). Quem mata essa ambiguidade é
#      atribuir um plano RECÉM-CADASTRADO no catálogo — só passa se o CHECK
#      tiver morrido. Prova ainda: plano ausente recusado no INSERT *e* no
#      UPDATE; rename no catálogo levando a org junto (CASCADE); DELETE de plano
#      com org recusado (RESTRICT) com o gatilho `trg_sync_org_plan_quotas`
#      desligado e `plan_id` NULO — senão quem recusaria seria a FK ANTIGA de
#      `plan_id` e o teste passaria sem provar nada da nova; esse isolamento é
#      CONDICIONAL, porque a SCRUM-338 derruba a coluna `plan_id` e o gatilho
#      junto, e nenhuma das duas fatias deve depender da ordem de merge da
#      outra; e NULO ainda
#      permitido, com a coluna omitida ficando NULA (sem NOT NULL, sem DEFAULT),
#      porque `create_org_sandbox` e o edge `test-workflow-system` inserem org
#      sem plano.
#  27. organizations_plan_quota_sync_test.sql — a cota segue o plano VIGENTE,
#      resolvido por NOME (SCRUM-338, 20270811000001). Exercita a porta REAL —
#      `UPDATE organizations SET subscription_plan` deixando o gatilho agir —
#      porque chamar `sync_org_plan_quotas()` direto provaria só que a função
#      faz o que a função faz. Nasceu VERMELHO contra o schema antigo, na forma
#      exata do defeito que mordeu produção em 11/08: `plan_base` ficava no
#      plano velho (2 do free em vez de 5 do pro) porque o gatilho resolvia por
#      `organizations.plan_id`, que só era preenchido quando NULO. Prova também
#      que `admin_adjustment` e `purchased_addons` SOBREVIVEM à sincronização
#      (há clientes com ajuste manual em produção), que -1 (ILIMITADO)
#      atravessa inteiro sem virar soma, que descer de plano também move a
#      cota, e que a coluna `plan_id` não existe mais.
#      Cobre ainda o par que não pode colapsar: chave AUSENTE de `limits`
#      (jsonb DEFAULT '{}') não rebaixa a cota para 0, enquanto chave presente
#      com 0 grava 0 — sem as duas, o pulo passaria verde por dois motivos. E o
#      ramo `subscription_plan` NULO, que só produção exercitava
#      (`create_org_sandbox`, edge `test-workflow-system`).
#
#  28. inv5_public_tables_readable_by_anon_test.sql — INV-5: nenhuma tabela de
#      `public` é legível por `anon`/`authenticated` sem RLS (20270811120000).
#      Nasceu de seis tabelas `_bkp_%` criadas À MÃO em produção que ficaram
#      legíveis por `anon` — uma delas com `uazapi_token`, credencial viva de
#      envio. Terceira vez da mesma classe de defeito. A causa NÃO é "herda o
#      GRANT do schema public": é `ALTER DEFAULT PRIVILEGES`, que faz toda
#      tabela criada em `public` NASCER com SELECT para `anon` — o default é
#      inseguro, e disciplina humana não fecha isso.
#      O INV-3 não pegou por três razões, e o arquivo ataca as três: população
#      (INV-3 só olha tabela com `organization_id`; três das seis não têm),
#      predicado (INV-3 testa só `relrowsecurity`, mas quem expõe é GRANT **e**
#      RLS off) e ONDE roda. Esta última é a que decide: a suíte corre contra um
#      banco montado de `supabase/migrations/*`, onde objeto feito à mão em
#      produção nunca existe. Por isso a fatia entrega também `pg_cron` 1x/dia
#      rodando o MESMO detector contra o banco vivo e escrevendo em
#      `runtime_logs`; só a suíte seria teatro para este achado.
#      As asserções vêm em PARES: o hard-0 (schema real limpo) E a falha
#      plantada, porque hard-0 sozinho passa verde tanto com detector correto
#      quanto com detector que nunca devolve linha. E o par CONSERTO 1 / CONSERTO
#      2 (ligar RLS limpa; revogar SELECT também limpa) é o que prova que o
#      predicado é conjunção honesta — um detector que olhasse só a RLS passaria
#      no primeiro e falharia no segundo. Cobre ainda: regressão (desligar a RLS
#      volta a acusar, provando que se lê ESTADO e não carimbo de criação),
#      `has_function_privilege` nome por nome nas duas funções novas (nem anon
#      nem authenticated executam), e o alarme exercitado pelo comando LITERAL
#      de `cron.job` — banco limpo não escreve nada (silêncio é o estado
#      normal), banco sujo escreve UMA linha `error` sem `organization_id` e com
#      a tabela nomeada no payload.
#
#  29. payment_links_test.sql — link de pagamento do billing (SCRUM-286,
#      20270811140000). A asserção que manda é NEGATIVA: o link NÃO é
#      recuperável do banco. Molde `generate_api_key` — guarda-se o SHA-256 de
#      16 bytes aleatórios, nunca o texto, então dump não entrega link vivo e o
#      Master copia o link uma única vez.
#      Provar isso comparando hash com sha256(token) seria fraco: mostraria que
#      o hash está certo, não que o texto está AUSENTE — uma coluna extra
#      guardando o link passaria verde. Por isso a prova VARRE dinamicamente
#      toda coluna de texto e jsonb das tabelas novas E de `master_audit_logs`,
#      sem lista escrita à mão: coluna nova nasce fora de lista fixa, e é a
#      coluna nova que vaza. Provado com dois mutantes — auditoria registrando o
#      token, e uma coluna `raw_token` — e o segundo só é pego porque a varredura
#      é dinâmica.
#      O resto ataca o que custou caro neste banco no mesmo dia (23 RPCs DEFINER
#      fechadas por escrita/leitura cross-tenant): toda função nova é exercida
#      como `authenticated` NÃO-master e os grants vão conferidos nome por nome,
#      porque `DROP + CREATE` devolve EXECUTE a PUBLIC. Cobre ainda: alvo
#      coerente por CHECK (org existente exige a org, org nova a proíbe);
#      gerar link NÃO toca a assinatura da org — a troca é no pagamento, não na
#      proposta; política do motor herdada (Pix mensal recusado) com recusa PURA,
#      sem linha órfã; revogação como ESTADO e não deleção; e a idempotência por
#      (link, método), que é o que impede QR velho, entulho de cobrança no
#      gateway e recarregar-a-página-virar-gerador-de-cobrança.
#
#  32. payment_links_package_test.sql — SCRUM-288 (Fatia 7): o pacote montado, o
#      desconto manual auditável e o COMPRADOR pré-preenchido pelo Master. As
#      asserções que mandam são NEGATIVAS: `payment_links` NÃO tem
#      `customer_legal_name`, `customer_tax_id` nem `customer_email`. A primeira
#      versão da fatia guardava PII ali, e essa tabela tem GRANT para `anon` e
#      `authenticated` com UMA policy no caminho; o comprador mora em
#      `payment_link_buyers` (item 36), fechada por REVOKE. Sem a asserção
#      negativa, alguém recria as colunas em seis meses e nada fica vermelho.
#      Cobre também ATOMICIDADE (comprador inválido derruba a criação do link,
#      porque a porta LEVANTA dentro da mesma transação) e a semântica que custou
#      duas asserções: `p_manual_final_cents` é o preço MENSAL, não o total —
#      passar o total de um ciclo anual não dá desconto, dá aumento de 12x.
#      DEPENDE de 20270812111845 (Fatia 8) estar aplicada: dela são a tabela e a
#      porta `billing_prefill_link_buyer`.
#
#  33. payment_history_receipt_period_method_test.sql — as tres faltas de
#      `payment_history` que travavam a area de billing do admin (SCRUM-289 /
#      #1390, migration 20270811160000): recibo e fatura (DUAS colunas, porque
#      sao dois documentos — a fatura existe desde a emissao, o recibo so depois
#      da liquidacao), o PERIODO coberto (sem ele "Referente a" nao e derivavel
#      em ciclo semestral ou anual: `paid_at` diz quando pagou, nao o que
#      cobriu) e a forma de pagamento por linha.
#      Alem de "a coluna existe", prova que os dois CHECK MORDEM — periodo
#      invertido e forma fora do vocabulario do Asaas sao recusados, porque
#      constraint que nao recusa nada e documentacao que se acha codigo — e que
#      NULO segue valido nas cinco, que e o que impede a migration de quebrar
#      uma ingestao que nem existe no repositorio ainda.
#  34. payment_webhook_ledger_test.sql — o que faz a re-entrega do gateway ser
#      inofensiva (SCRUM-287, migration 20270811220000). A entrega do Asaas e
#      at-least-once e o `id` do evento (`evt_...`) se repete: a idempotencia ou
#      mora no BANCO, ou o handler perde a corrida entre duas entregas
#      simultaneas — um SELECT antes do INSERT nao protege nada quando as duas
#      chegam no mesmo milissegundo.
#      Prova: o mesmo evt_ duas vezes deixa UMA linha; o mesmo cupom no mesmo
#      pagamento resgata UMA vez e no pagamento SEGUINTE resgata de novo (senao
#      o cupom valeria uma vez na vida); tipo DESCONHECIDO tem onde ser gravado
#      (`unknown_type`), porque devolver erro pausa a fila do provedor e derruba
#      o recebimento de TODA a receita; e nem anon nem authenticated alcancam os
#      dois livros — `increment_coupon_uses` deixa de ser um POST que queima uso
#      de cupom alheio.
#  36. payment_link_buyers_test.sql — o COMPRADOR da proposta (SCRUM-289,
#      migration 20270812111845). A Asaas exige `cpfCnpj` para Pix e cartao, e o
#      e-mail coletado aqui e o unico caminho pelo qual a Fatia 9 cria o admin da
#      organizacao nova — sem persistir, o dado passa, vai para o gateway e some.
#      Duas asserções mandam, as duas NEGATIVAS: (a) nem anon, nem authenticated,
#      nem service_role tem GRANT na tabela de comprador — a PII fica fora do
#      PostgREST por CONSTRUCAO, nao por policy, que e o controle que a gente
#      pode errar; (b) varredura generica de toda coluna de texto/jsonb de
#      `public` prova que o documento fiscal existe em UMA coluna, a que existe
#      para guarda-lo.
#      Cobre ainda a regressao de caminho VIVO: `provider_charge_id` passa a ser
#      UNICO. `asaas-webhook` ja resolve o link com `.maybeSingle()` nessa busca
#      e engole erro com 200 — duplicata seria organizacao nunca ativada, em
#      silencio. E prova que a retentativa (mesmo link, mesmo metodo, mesma
#      cobranca) continua REUSANDO com a segunda restricao unica no ar, que e a
#      regressao que o UNIQUE novo introduziria sozinho.

#  35. provision_existing_org_test.sql — o pagamento vira ACESSO para
#      organizacao existente (Fatia 9, migration 20270812100000). A assercao
#      que manda NAO e "a linha foi escrita": e que a COTA chega sem ninguem
#      escrever cota. O provisionamento grava o NOME do plano em
#      organizations.subscription_plan e trg_sync_org_plan_quotas (SCRUM-338)
#      sincroniza org_quotas.plan_base sozinho — escrever cota aqui recriaria a
#      segunda fonte de verdade que aquela fatia matou.
#      Prova tambem: cobranca sem assinatura recusa LIMPO (ordem de chegada,
#      nao incidente); o par CONFIRMED/RECEIVED ativa UMA vez (UNIQUE no livro,
#      nao IF no codigo); renovar antes de vencer SOMA o ciclo em vez de jogar
#      fora os dias pagos; e nem anon nem authenticated ativam organizacao.

#  37. payment_link_paid_at_test.sql — a recusa que NUNCA acontecia.
#      `payment_links.paid_at` era declarado, indexado e LIDO em tres pontos de
#      decisao — e escrito em NENHUM. `billing_attach_link_charge` recusa
#      cobranca em link ja pago pelo predicado `paid_at IS NOT NULL`; com a
#      coluna sempre nula, aquela recusa era codigo morto.
#      O custo era do CLIENTE: paga no Pix, recarrega a pagina, clica em cartao,
#      e nasce uma SEGUNDA cobranca no gateway para uma proposta ja paga — a
#      idempotencia por (link, metodo) nao salva, porque metodos diferentes sao
#      linhas diferentes POR DESENHO.
#      Este arquivo prova a recusa ACONTECENDO, e prova tambem que ela e PURA
#      (nenhuma linha de cobranca nasce dela) e que a re-entrega NAO move o
#      carimbo — vale a PRIMEIRA confirmacao, porque no cartao o RECEIVED chega
#      32 dias depois do CONFIRMED.
#  38. provision_new_org_test.sql — pagamento de organizacao NOVA vira
#      organizacao + acesso (Fatia 9 parte 2, migration 20270812160000).
#      A assercao mais grave nao e "a org nasce": e que PAGAMENTO CONFIRMADO SEM
#      COMPRADOR NAO SOME. Vira linha BLOQUEADA e visivel no livro, com dono
#      NULO — e ha CHECK provando que "provisionado sem dono" continua proibido,
#      porque linha orfa e pior que ausencia. E o alarme sai UMA vez: o worker
#      passa a cada 2 min, e repetir afogaria o sinal em vez de emitir um.
#      Prova tambem: tudo numa transacao (org + historico + assinatura +
#      ativacao); a COTA chega sem ninguem escrever cota (gatilho da SCRUM-338);
#      a re-entrega NAO cria uma segunda organizacao; link de org EXISTENTE e
#      recusado aqui, senao quem ja tem org ganharia uma segunda.

#  14. assert_org_access_test.sql     — gate de tenancy dos leitores SECURITY
#      DEFINER (#1209): membro ATIVO passa, membro DESATIVADO é BLOQUEADO (o
#      furo: lia receita/ranking/comissão da org que o desativou), master e
#      service_role passam, gestor de portfólio passa nas orgs que gerencia
#      (ADR-0021). Inclui planted-failure: replanta a definição antiga e prova
#      que sob ela o desativado passava e o gestor era bloqueado.
#
#  30. rls_inv6_definer_sem_gate_test.sql — INV-6 (SCRUM-339): nenhuma função
#      SECURITY DEFINER em `public` alcançável por anon/authenticated pode
#      existir sem portão de autorização no corpo. É o invariante que faltava
#      quando, em 11/08, fechamos 23 funções com exatamente essa forma — a que
#      deixou despachar WhatsApp pelo número da vítima, enfileirar webhook com
#      corpo escolhido pelo atacante, escrever em `organizations` e devolver
#      telefone de lead de qualquer organização.
#      O recorte é por QUEM ALCANÇA, nunca por qual parâmetro a função recebe:
#      `schedule_rule_steps_from_position` escapou de três varreduras porque
#      recebe `whatsapp_instance_id` e não org. E NÃO exige escrita no corpo: o
#      primeiro recorte pedia INSERT/UPDATE/DELETE, achou 9 onde havia 24, e as
#      que faltavam eram justamente as que exfiltravam. Nasce como RATCHET
#      (teto em rls_invariants_baseline.sql), com prova plantada em transação
#      revertida de que morde e de que os DOIS caminhos de conserto limpam.
#
#  31. billing_cycle_semiannual_test.sql — `semiannual` é o nome canônico do
#      ciclo semestral (SCRUM-289 §4.0). Prova por COMPORTAMENTO, não por
#      estrutura: o que o banco ACEITA e o que RECUSA. Antes da migration
#      20270811150000 o ciclo semestral não entrava com NENHUM dos dois nomes —
#      `org_subscriptions` carregava dois CHECK contraditórios (o do baseline
#      exigindo `semester` e o de 20270807000002 exigindo `semiannual`), ANDados
#      numa interseção {monthly, annual}. Cobre a consequência de negócio:
#      `pix + semiannual` volta a ser inserível, e `pix + monthly` continua
#      recusado — abrir o semestre não afrouxou a regra do Pix.
#
#  39. disparo_resolvers_org_scope_test.sql — os 5 resolvers de PÚBLICO do
#      Disparo escopam pela org pedida (SCRUM-429, migration 20270822180000). O
#      predicado de tenancy autorizava (`OR` com o ramo master) mas não escopava,
#      então master pedindo a org B recebia B mais todas as outras — num caminho
#      que ENVIA WhatsApp. O comportamento é provado com auth real nas suítes de
#      integração; aqui a asserção é de CATÁLOGO (`pg_proc.prosrc`), porque o que
#      escapa da integração é a regressão silenciosa: um `CREATE OR REPLACE`
#      futuro que deixe a linha cair de UM dos cinco — ou, na união de
#      `get_all_funnels_lead_ids`, de UM dos dois ramos. Cobre também a direção
#      oposta (o ramo master preservado, senão o master-ghost volta), que nenhum
#      deles virou SECURITY DEFINER (a RLS de `leads` é o backstop) e que
#      `authenticated` manteve EXECUTE após o REPLACE.

#  40. caixa_unificada_lista_por_conjunto_test.sql — a Caixa de Entrada
#      Unificada (SCRUM-649/SCRUM-657, migration 20270926000000). As duas
#      listas de conversa passam a aceitar um CONJUNTO de Instances, e as
#      funções são IRMÃS: nenhum DROP, nenhum CREATE OR REPLACE nas atuais.
#      O bloco (R) é quem defende essa decisão — assinatura, sobrecarga única,
#      grants e recusas (`instance required`, `instance not in org`) das
#      ANTIGAS, afirmadas uma a uma.
#      A asserção que manda é o CONTROLE POSITIVO em pares. Toda negativa desta
#      suíte tem uma positiva do lado: caixa proibida some para quem está fora
#      da lista E aparece para quem está dentro; a conversa que o limite corta
#      VOLTA com limite maior (some por paginação, não por acesso); e, com
#      `chat_restrict_to_owner` ligado, o não-responsável NÃO vê e o
#      responsável VÊ — as duas listas. Sem o par, lista vazia passa por
#      segura sendo bug, que foi como o furo equivalente sobreviveu no caminho
#      social.
#      Cobre ainda: conjunto nulo/vazio = "todas as que eu posso ler"; Instance
#      de outra org nunca entra nem misturada nem sozinha; o limite recorta por
#      recência do CONJUNTO (a página inteira pode sair de uma caixa só);
#      `instance_id` é a primeira coluna de saída das duas listas; o mesmo
#      telefone em duas caixas são DUAS conversas (DISTINCT ON por chip ×
#      telefone); a não-lida conta só o chip da própria caixa e ler numa não
#      zera a outra; admin da org e master EM SHADOW passam por cima da lista
#      de membros permitidos; e `anon`/PUBLIC não executam nenhuma das três
#      funções novas (função nasce com EXECUTE para PUBLIC se ninguém revogar).

# All files run inside rolled-back transactions, so none mutates the DB.
#
# Env:
#   DATABASE_URL  full libpq URL. Defaults to the supabase-local db on :54322.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

echo "==> pgTAP suites (RLS invariants #638 + metric period bounds #989)"
echo "    DB: ${DATABASE_URL%%\?*}"

# pgTAP harness. Prefer pg_prove (TAP aggregation); fall back to raw psql if the
# Perl TAP harness is not installed on the runner.
run_with_pg_prove() {
  pg_prove --verbose --ext .sql -d "$DATABASE_URL" \
    "$SCRIPT_DIR/rls_invariants_red_fixture.sql" \
    "$SCRIPT_DIR/rls_invariants.sql" \
    "$SCRIPT_DIR/metric_period_bounds_test.sql" \
    "$SCRIPT_DIR/stage_role_test.sql" \
    "$SCRIPT_DIR/stage_role_money_guard_test.sql" \
    "$SCRIPT_DIR/pipeline_stage_events_test.sql" \
    "$SCRIPT_DIR/sale_events_test.sql" \
    "$SCRIPT_DIR/sale_events_state_backfill_test.sql" \
    "$SCRIPT_DIR/get_sales_metrics_test.sql" \
    "$SCRIPT_DIR/get_funnel_flow_test.sql" \
    "$SCRIPT_DIR/get_ranking_test.sql" \
    "$SCRIPT_DIR/get_commission_ledger_test.sql" \
    "$SCRIPT_DIR/custom_pipeline_stages_stage_role_test.sql" \
    "$SCRIPT_DIR/duplicate_leads_rpcs_test.sql" \
    "$SCRIPT_DIR/password_reset_grants_test.sql" \
    "$SCRIPT_DIR/assert_org_access_test.sql" \
    "$SCRIPT_DIR/export_lead_data_authz_test.sql" \
    "$SCRIPT_DIR/deal_procedencia_test.sql" \
    "$SCRIPT_DIR/auto_seed_card_morto_test.sql" \
    "$SCRIPT_DIR/deal_last_activity_test.sql" \
    "$SCRIPT_DIR/api_lead_create_search_test.sql" \
    "$SCRIPT_DIR/api_create_deal_test.sql" \
    "$SCRIPT_DIR/workflow_deal_created_position_test.sql" \
    "$SCRIPT_DIR/api_read_deal_test.sql" \
    "$SCRIPT_DIR/api_update_deal_test.sql" \
    "$SCRIPT_DIR/api_move_deal_test.sql" \
    "$SCRIPT_DIR/metric_revenue_stream_test.sql" \
    "$SCRIPT_DIR/sale_events_producer_identity_test.sql" \
    "$SCRIPT_DIR/carteira_emits_sale_events_test.sql" \
    "$SCRIPT_DIR/funnel_stream_by_customer_moment_test.sql" \
    "$SCRIPT_DIR/reetiqueta_funnel_streams_test.sql" \
    "$SCRIPT_DIR/composable_metrics_engine_test.sql" \
    "$SCRIPT_DIR/metric_leads_sem_responsavel_test.sql" \
    "$SCRIPT_DIR/metric_qualidade_lead_test.sql" \
    "$SCRIPT_DIR/metric_negocios_perdidos_test.sql" \
    "$SCRIPT_DIR/metric_tempo_resposta_test.sql" \
    "$SCRIPT_DIR/metric_taxa_qualidade_test.sql" \
    "$SCRIPT_DIR/metric_reunioes_no_show_test.sql" \
    "$SCRIPT_DIR/metric_negocio_semantica_test.sql" \
    "$SCRIPT_DIR/metric_custom_tree_test.sql" \
    "$SCRIPT_DIR/metric_conversao_etapas_test.sql" \
    "$SCRIPT_DIR/metric_coorte_canonica_test.sql" \
    "$SCRIPT_DIR/metric_ganho_perda_test.sql" \
    "$SCRIPT_DIR/metric_taxa_pre_venda_test.sql" \
    "$SCRIPT_DIR/metric_ltv_test.sql" \
    "$SCRIPT_DIR/metric_clientes_sem_resposta_test.sql" \
    "$SCRIPT_DIR/metric_taxa_resposta_automacao_test.sql" \
    "$SCRIPT_DIR/metric_clientes_sem_atuacao_test.sql" \
    "$SCRIPT_DIR/metric_curva_abc_test.sql" \
    "$SCRIPT_DIR/tv_shell_legacy_cells_and_seed_test.sql" \
    "$SCRIPT_DIR/tv_reseed_s1_test.sql" \
    "$SCRIPT_DIR/tv_s2_stage_label_scope_test.sql" \
    "$SCRIPT_DIR/parity_p1_measures_test.sql" \
    "$SCRIPT_DIR/send_dedup_log_test.sql" \
    "$SCRIPT_DIR/voip_foundation_test.sql" \
    "$SCRIPT_DIR/voip_gate_test.sql" \
    "$SCRIPT_DIR/voip_call_id_provenance_test.sql" \
    "$SCRIPT_DIR/voip_sweep_stuck_calls_test.sql" \
    "$SCRIPT_DIR/voip_reserve_inbound_requires_tc_call_id_test.sql" \
    "$SCRIPT_DIR/voip_webhook_ingest_test.sql" \
    "$SCRIPT_DIR/voip_reserve_instance_access_test.sql" \
    "$SCRIPT_DIR/voip_call_log_projection_test.sql" \
    "$SCRIPT_DIR/voip_recording_ingest_test.sql" \
    "$SCRIPT_DIR/voip_recording_playback_test.sql" \
    "$SCRIPT_DIR/voip_recording_retention_test.sql" \
    "$SCRIPT_DIR/voip_incoming_creates_call_test.sql" \
    "$SCRIPT_DIR/voip_can_see_call_dono_canonico_test.sql" \
    "$SCRIPT_DIR/whatsapp_instance_reap_queue_test.sql" \
    "$SCRIPT_DIR/subscription_snapshot_base_layer_test.sql" \
    "$SCRIPT_DIR/organizations_plan_fk_test.sql" \
    "$SCRIPT_DIR/organizations_plan_quota_sync_test.sql" \
    "$SCRIPT_DIR/inv5_public_tables_readable_by_anon_test.sql" \
    "$SCRIPT_DIR/payment_links_test.sql" \
    "$SCRIPT_DIR/rls_inv6_definer_sem_gate_test.sql" \
    "$SCRIPT_DIR/billing_cycle_semiannual_test.sql" \
    "$SCRIPT_DIR/payment_links_package_test.sql" \
    "$SCRIPT_DIR/payment_history_receipt_period_method_test.sql" \
    "$SCRIPT_DIR/payment_webhook_ledger_test.sql" \
    "$SCRIPT_DIR/provision_existing_org_test.sql" \
    "$SCRIPT_DIR/payment_link_buyers_test.sql" \
    "$SCRIPT_DIR/payment_link_paid_at_test.sql" \
    "$SCRIPT_DIR/provision_new_org_test.sql" \
    "$SCRIPT_DIR/disparo_resolvers_org_scope_test.sql" \
    "$SCRIPT_DIR/avisos_coalescing_red_fixture.sql" \
    "$SCRIPT_DIR/avisos_coalescing_test.sql" \
    "$SCRIPT_DIR/avisos_produtores_test.sql" \
    "$SCRIPT_DIR/avisos_automacao_test.sql" \
    "$SCRIPT_DIR/avisos_varreduras_test.sql" \
    "$SCRIPT_DIR/avisos_preferencias_test.sql" \
    "$SCRIPT_DIR/avisos_push_test.sql" \
    "$SCRIPT_DIR/avisos_limpeza_test.sql" \
    "$SCRIPT_DIR/lead_custom_fields_org_em_uso_test.sql" \
    "$SCRIPT_DIR/org_plural_em_todas_as_policies_test.sql" \
    "$SCRIPT_DIR/caixa_unificada_lista_por_conjunto_test.sql"
}

run_with_psql() {
  local f
  for f in rls_invariants_red_fixture.sql rls_invariants.sql metric_period_bounds_test.sql stage_role_test.sql stage_role_money_guard_test.sql pipeline_stage_events_test.sql sale_events_test.sql sale_events_state_backfill_test.sql commission_projection_test.sql get_sales_metrics_test.sql get_funnel_flow_test.sql get_ranking_test.sql get_commission_ledger_test.sql productivity_canonical_test.sql custom_pipeline_stages_stage_role_test.sql duplicate_leads_rpcs_test.sql password_reset_grants_test.sql assert_org_access_test.sql export_lead_data_authz_test.sql metric_revenue_stream_test.sql sale_events_producer_identity_test.sql carteira_emits_sale_events_test.sql funnel_stream_by_customer_moment_test.sql reetiqueta_funnel_streams_test.sql composable_metrics_engine_test.sql metric_leads_sem_responsavel_test.sql metric_qualidade_lead_test.sql metric_negocios_perdidos_test.sql metric_tempo_resposta_test.sql metric_taxa_qualidade_test.sql metric_reunioes_no_show_test.sql metric_negocio_semantica_test.sql metric_custom_tree_test.sql tv_shell_legacy_cells_and_seed_test.sql tv_reseed_s1_test.sql tv_s2_stage_label_scope_test.sql parity_p1_measures_test.sql send_dedup_log_test.sql voip_foundation_test.sql voip_gate_test.sql voip_call_id_provenance_test.sql voip_sweep_stuck_calls_test.sql voip_reserve_inbound_requires_tc_call_id_test.sql voip_webhook_ingest_test.sql voip_reserve_instance_access_test.sql voip_call_log_projection_test.sql voip_recording_ingest_test.sql voip_recording_playback_test.sql voip_recording_retention_test.sql voip_incoming_creates_call_test.sql whatsapp_instance_reap_queue_test.sql subscription_snapshot_base_layer_test.sql organizations_plan_fk_test.sql organizations_plan_quota_sync_test.sql inv5_public_tables_readable_by_anon_test.sql payment_links_test.sql rls_inv6_definer_sem_gate_test.sql billing_cycle_semiannual_test.sql payment_links_package_test.sql payment_history_receipt_period_method_test.sql payment_webhook_ledger_test.sql provision_existing_org_test.sql payment_link_buyers_test.sql provision_new_org_test.sql payment_link_paid_at_test.sql metric_conversao_etapas_test.sql metric_coorte_canonica_test.sql metric_ganho_perda_test.sql metric_taxa_pre_venda_test.sql metric_ltv_test.sql metric_clientes_sem_resposta_test.sql metric_taxa_resposta_automacao_test.sql metric_clientes_sem_atuacao_test.sql metric_curva_abc_test.sql disparo_resolvers_org_scope_test.sql deal_procedencia_test.sql auto_seed_card_morto_test.sql deal_last_activity_test.sql api_lead_create_search_test.sql api_create_deal_test.sql workflow_deal_created_position_test.sql api_read_deal_test.sql api_update_deal_test.sql api_move_deal_test.sql avisos_coalescing_red_fixture.sql avisos_coalescing_test.sql avisos_produtores_test.sql avisos_automacao_test.sql avisos_varreduras_test.sql avisos_preferencias_test.sql avisos_push_test.sql avisos_limpeza_test.sql lead_custom_fields_org_em_uso_test.sql org_plural_em_todas_as_policies_test.sql caixa_unificada_lista_por_conjunto_test.sql; do
    echo "----- running $f via psql -----"
    # --variable ON_ERROR_STOP=1 turns any pgTAP failure (which RAISEs) into a
    # non-zero exit. We also grep for a TAP "not ok" line as a belt-and-braces
    # failure signal, since `is()`/`ok()`/`cmp_ok()` REPORT rather than raise.
    #
    # -t -A (tuples-only, unaligned) is load-bearing: without it psql prints TAP
    # inside its ALIGNED table layout, so every `not ok` line comes out as
    # "␠not ok N" (leading space + column framing). That made the old
    # `^not ok` anchor never match — with pg_prove absent, every failing
    # assertion in all 12 suites was silently reported as PASS. -t -A emits TAP
    # at column 0; the widened `(^|[[:space:]])not ok` grep is a second belt.
    local out
    out="$(psql "$DATABASE_URL" \
            --no-psqlrc --quiet -t -A \
            --variable ON_ERROR_STOP=1 \
            --file "$SCRIPT_DIR/$f" 2>&1)"
    echo "$out"
    if grep -Eq '(^|[[:space:]])not ok' <<<"$out"; then
      echo "FAILED: $f reported a 'not ok' assertion" >&2
      return 1
    fi
  done
}


# ─────────────────────────────────────────────────────────────────────────────
# SUÍTES PENDENTES — testam feature que NÃO EXISTE, e por isso não derrubam
# ─────────────────────────────────────────────────────────────────────────────
#
# Duas suítes deste diretório foram escritas ANTES da feature que elas medem, e
# a feature nunca chegou. Medido em produção em 2026-08-21:
#
#   commission_projection_test  → `sale_events` tem TRÊS gatilhos
#     (fn_carteira_admite_venda, fn_sale_events_force_sold_at,
#     fn_sale_events_block_mutation) e NENHUM projeta comissão. 26 das 42
#     asserções falham a partir de "projeção encadeada no caderno de venda".
#     Card: SCRUM-416.
#
#   productivity_canonical_test → o cabeçalho dela diz "a dimensão vendido lê SÓ
#     sale_events". `get_productivity_activity` em produção NÃO MENCIONA
#     sale_events: conta por `pipeline_entries` + `lead_history`, com o COALESCE
#     encadeado de chaves de atribuição que o próprio ADR-0017 §2 proíbe.
#     Card: SCRUM-415.
#
# Elas não são regressão — são ESPECIFICAÇÃO esperando implementação. Deixá-las
# no bloco principal mantém o job vermelho para sempre por dívida que nenhuma
# branch introduziu, e portão que nasce vermelho é portão que ninguém lê. Mesma
# razão do ratchet do vitest e do tsc.
#
# ⚠ O RATCHET SÓ ENCOLHE: se uma pendente PASSAR, este script REPROVA pedindo
# que ela seja promovida. Sem isso a lista viraria depósito, e uma feature
# entregue ficaria com o teste dela fora do portão.
SUITES_PENDENTES=(
  "commission_projection_test.sql"
  "productivity_canonical_test.sql"
)

rodar_pendentes() {
  local caminhos=()
  local f
  for f in "${SUITES_PENDENTES[@]}"; do caminhos+=("$SCRIPT_DIR/$f"); done

  echo "==> ${#SUITES_PENDENTES[@]} suíte(s) PENDENTE(S) (feature não construída — SCRUM-415, SCRUM-416)"

  local passou=0
  if command -v pg_prove >/dev/null 2>&1; then
    pg_prove --ext .sql -d "$DATABASE_URL" "${caminhos[@]}" && passou=1
  else
    local todas_ok=1
    for f in "${SUITES_PENDENTES[@]}"; do
      local out
      out="$(psql "$DATABASE_URL" --no-psqlrc --quiet -t -A \
              --variable ON_ERROR_STOP=1 --file "$SCRIPT_DIR/$f" 2>&1)" || todas_ok=0
      grep -Eq '(^|[[:space:]])not ok' <<<"$out" && todas_ok=0
    done
    passou=$todas_ok
  fi

  if [ "$passou" -eq 1 ]; then
    echo "FAIL: suíte pendente PASSOU — a feature foi construída." >&2
    echo "      Promova-a para a lista principal (as duas de run_with_*) e" >&2
    echo "      tire-a de SUITES_PENDENTES. O ratchet só encolhe." >&2
    exit 1
  fi

  echo "==> pendentes seguem vermelhas, como esperado. Não derrubam o job."
}

if command -v pg_prove >/dev/null 2>&1; then
  echo "==> using pg_prove"
  run_with_pg_prove
else
  echo "==> pg_prove not found; using psql fallback"
  run_with_psql
fi

rodar_pendentes

echo "==> pgTAP suites passed"
