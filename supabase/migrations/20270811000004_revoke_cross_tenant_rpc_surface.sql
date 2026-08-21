-- 20270811000004_revoke_cross_tenant_rpc_surface.sql
--
-- APLICADA EM PRODUÇÃO em 2026-08-11 com autorização do CTO. Este arquivo traz a
-- mudança ao repositório.
--
-- ATENÇÃO — SEM ESTE ARQUIVO, TODO AMBIENTE NOVO NASCE VULNERÁVEL. O `REVOKE`
-- foi aplicado direto em produção, então banco criado por `db reset`, branch
-- efêmera ou projeto novo continuava servindo estas funções a qualquer usuário
-- logado. Achado na revisão cruzada.
--
-- ─── O VETOR ────────────────────────────────────────────────────────────────
--
-- `enqueue_webhook_deliveries_for_org` e `fire_workflow_trigger` são
-- SECURITY DEFINER de dono `postgres` (superusuário, ignora RLS), recebem
-- `organization_id` POR PARÂMETRO e não têm gate: zero `auth.uid()`, zero
-- `assert_org_access`, zero join de associação. O org_id que chega é obedecido.
-- Ambas eram executáveis por `authenticated`, logo servidas pelo PostgREST em
-- `/rest/v1/rpc/<nome>` para qualquer sessão logada.
--
-- PROVA por execução, não por leitura: sob `SET LOCAL ROLE authenticated` sem
-- JWT, em transação revertida. Controle negativo — `INSERT` direto em
-- `webhook_deliveries` como `authenticated` devolve "new row violates row-level
-- security policy", provando que a RLS segura. A MESMA escrita via RPC PASSA.
--
-- Dano: `enqueue_webhook_deliveries_for_org` faz o Torque entregar um POST HTTP,
-- com corpo escolhido pelo atacante, no webhook de outra empresa, com a
-- credencial e a reputação do Torque — o laço fecha em
-- `process-webhook-deliveries`, que seleciona por `next_retry_at <= now()` sem
-- checar origem e entrega como service_role. `fire_workflow_trigger` cria
-- execução com contexto controlado na org vítima, e os nós incluem envio de
-- WhatsApp pela instância dela: cross-tenant E vetor de ban.
--
-- ─── POR QUE REVOGAR NÃO QUEBRA NADA ────────────────────────────────────────
--
-- Medido antes de aplicar:
--   * nenhum chamador no produto — nem em `src/`, nem em edge function;
--   * as 22 funções que as chamam internamente (7 + 15) são TODAS
--     `SECURITY DEFINER` de dono `postgres`, que mantém EXECUTE. `DEFINER` roda
--     como DONO, não como quem chamou — o `PERFORM` interno não depende do grant
--     de quem disparou;
--   * edge functions usam `service_role`, que mantém EXECUTE.
-- Revogar remove só a porta do navegador.
--
-- ATENÇÃO ao verificar esta hipótese em outras funções: ela NÃO é geral. Existe
-- pelo menos um chamador INVOKER neste banco (`trigger_create_default_stages`,
-- que chama `create_default_pipelines`). Medir o modo de cada chamador, nunca
-- deduzir.
--
-- ─── LIMITE DESTA CONTENÇÃO ─────────────────────────────────────────────────
--
-- Isto é conserto de ponto no tempo. `DROP+CREATE` futuro em qualquer uma delas
-- devolve EXECUTE a PUBLIC e reabre o vetor — este repositório já apanhou disso.
-- O conserto durável é o molde `_unchecked` service_role-only + wrapper que
-- autoriza, porque aí a autorização vive no CORPO e não no grant.

REVOKE EXECUTE ON FUNCTION public.enqueue_webhook_deliveries_for_org(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fire_workflow_trigger(uuid, text, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
