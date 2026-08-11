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
#   7. commission_projection_test.sql  — commission as projection of the sale
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
#  12. productivity_canonical_test.sql — produtividade activity-in-period (#1000,
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
#
#  14. assert_org_access_test.sql     — gate de tenancy dos leitores SECURITY
#      DEFINER (#1209): membro ATIVO passa, membro DESATIVADO é BLOQUEADO (o
#      furo: lia receita/ranking/comissão da org que o desativou), master e
#      service_role passam, gestor de portfólio passa nas orgs que gerencia
#      (ADR-0021). Inclui planted-failure: replanta a definição antiga e prova
#      que sob ela o desativado passava e o gestor era bloqueado.
#
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
    "$SCRIPT_DIR/commission_projection_test.sql" \
    "$SCRIPT_DIR/get_sales_metrics_test.sql" \
    "$SCRIPT_DIR/get_funnel_flow_test.sql" \
    "$SCRIPT_DIR/get_ranking_test.sql" \
    "$SCRIPT_DIR/get_commission_ledger_test.sql" \
    "$SCRIPT_DIR/productivity_canonical_test.sql" \
    "$SCRIPT_DIR/custom_pipeline_stages_stage_role_test.sql" \
    "$SCRIPT_DIR/duplicate_leads_rpcs_test.sql" \
    "$SCRIPT_DIR/assert_org_access_test.sql" \
    "$SCRIPT_DIR/metric_revenue_stream_test.sql" \
    "$SCRIPT_DIR/sale_events_producer_identity_test.sql" \
    "$SCRIPT_DIR/carteira_emits_sale_events_test.sql" \
    "$SCRIPT_DIR/funnel_stream_by_customer_moment_test.sql" \
    "$SCRIPT_DIR/reetiqueta_funnel_streams_test.sql" \
    "$SCRIPT_DIR/composable_metrics_engine_test.sql" \
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
    "$SCRIPT_DIR/whatsapp_instance_reap_queue_test.sql" \
    "$SCRIPT_DIR/subscription_snapshot_base_layer_test.sql" \
    "$SCRIPT_DIR/organizations_plan_fk_test.sql"
}

run_with_psql() {
  local f
  for f in rls_invariants_red_fixture.sql rls_invariants.sql metric_period_bounds_test.sql stage_role_test.sql stage_role_money_guard_test.sql pipeline_stage_events_test.sql sale_events_test.sql sale_events_state_backfill_test.sql commission_projection_test.sql get_sales_metrics_test.sql get_funnel_flow_test.sql get_ranking_test.sql get_commission_ledger_test.sql productivity_canonical_test.sql custom_pipeline_stages_stage_role_test.sql duplicate_leads_rpcs_test.sql assert_org_access_test.sql metric_revenue_stream_test.sql sale_events_producer_identity_test.sql carteira_emits_sale_events_test.sql funnel_stream_by_customer_moment_test.sql reetiqueta_funnel_streams_test.sql composable_metrics_engine_test.sql tv_shell_legacy_cells_and_seed_test.sql tv_reseed_s1_test.sql tv_s2_stage_label_scope_test.sql parity_p1_measures_test.sql send_dedup_log_test.sql voip_foundation_test.sql voip_gate_test.sql voip_call_id_provenance_test.sql voip_sweep_stuck_calls_test.sql voip_reserve_inbound_requires_tc_call_id_test.sql voip_webhook_ingest_test.sql voip_reserve_instance_access_test.sql voip_call_log_projection_test.sql voip_recording_ingest_test.sql voip_recording_playback_test.sql voip_recording_retention_test.sql voip_incoming_creates_call_test.sql whatsapp_instance_reap_queue_test.sql subscription_snapshot_base_layer_test.sql organizations_plan_fk_test.sql; do
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

if command -v pg_prove >/dev/null 2>&1; then
  echo "==> using pg_prove"
  run_with_pg_prove
else
  echo "==> pg_prove not found; using psql fallback"
  run_with_psql
fi

echo "==> pgTAP suites passed"
