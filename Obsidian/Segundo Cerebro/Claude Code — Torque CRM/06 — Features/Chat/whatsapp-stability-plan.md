---
type: feature
title: WhatsApp Stability — estado consolidado
status: active
created: 2026-04-12
updated: 2026-09-11
tags: [uncategorized]
related: []
owner: gabriel
---

# WhatsApp Stability — estado consolidado

Estado atual do plano de estabilização do pipeline WhatsApp (Uazapi → V8 webhook → DB → UI). Gerado após resolução do incidente Uazapi V2 schema change (2026-05-14).

**Doc primário no repo**: `docs/WHATSAPP_STABILITY_PLAN.md`
**Doc incidente**: `docs/INCIDENT_2026_05_14_UAZAPI_V2.md`
**Branch**: `fix/whatsapp-rebind-webhook`

## Funcionalidade hoje — ~82% (B2B típico)

Quebra honesta por dimensão. Veja seção "gaps abertos" pra restante.

| Dimensão | % | Notas |
|---|---|---|
| Inbound text 1:1 | 99% | Patch defensivo + DLQ |
| Outbound text | 95% | Sem dashboard de falhas |
| Outbound do celular do dono | 95% | `wasSentByApi` filtra eco, badge UI ausente |
| Realtime UI | 80% | Heartbeat + reconnect ok, fallback polling falta |
| Mídia | 70% | `persistMediaToStorage` fire-and-forget, sem retry |
| Grupos | 0% | Dropados intencional na linha 400 de `whatsapp-webhook` |
| Reactions / edit / pin / delete | ~60% | Handler existe, sem teste |
| Multi-atendente concorrente | 70% | Realtime ok, sem typing indicator humano |
| AI + handoff humano | 85% | Race condition rara |
| Visibilidade falhas | 60% | Dashboard `/master/whatsapp-health` ok, falta notificação ativa |
| Recovery sessão morta | 30% | Watchdog detecta, sem notificação dono nem UI banner |
| Cobertura teste | 50% | Helpers Uazapi V2 ok, E2E ausente |

## Plano (6 componentes — TODOS deployed em prod)

### 1. Dead Letter Queue inbound — DONE

Webhook agora persiste eventos que falham resolução em `whatsapp_webhook_dlq` em vez de drop silencioso. Replay edge function (cron 5min) reattempts. UPSERT preserva idempotência. 5 tentativas → Sentry + manual review.

**Artefatos**:
- `supabase/migrations/20261012000000_whatsapp_webhook_dlq.sql`
- `supabase/migrations/20261012000001_schedule_whatsapp_dlq_replay.sql`
- `supabase/functions/whatsapp-dlq-replay/index.ts`
- patch em `supabase/functions/whatsapp-webhook/index.ts` (helper `enqueueDlq`)
- `cron.job.whatsapp_dlq_replay` (`*/5 * * * *`, active)

### 2. Watchdog sessão WhatsApp — PARCIAL

Cron 10min compara Uazapi `/instance/all` vs DB. Stamps `whatsapp_instances.session_dead_since` em transições.

**Artefatos**:
- `supabase/migrations/20261012000002_whatsapp_session_dead_since.sql`
- `supabase/migrations/20261012000003_schedule_whatsapp_session_watchdog.sql`
- `supabase/functions/whatsapp-session-watchdog/index.ts`
- `cron.job.whatsapp_session_watchdog` (`*/10 * * * *`, active)

**O que FALTA pra fechar**:
- Notificação dono (push V8 + email) quando watchdog detecta dead
- UI banner persistente nas páginas WhatsApp/chat enquanto `session_dead_since IS NOT NULL`

### 3. Health monitor + auto-rebind — DONE

Drift = `v8_inbound_1h / uazapi_inbound_1h` por instância connected. <0.5 → auto-rebind (cooldown 30min). <0.9 → warning.

**Artefatos**:
- `supabase/migrations/20261012000004_whatsapp_health_checks.sql`
- `supabase/migrations/20261012000005_schedule_whatsapp_health_monitor.sql`
- `supabase/functions/whatsapp-health-monitor/index.ts`
- `cron.job.whatsapp_health_monitor` (`*/5 * * * *`, active)

### 4. Realtime cliente robusto — PARCIAL

Heartbeat 30s + reconnect on stale + visibility/online listeners + status badge.

**Artefatos**:
- `src/lib/realtimeStatusStore.ts` (pub/sub módulo)
- `src/hooks/useRealtimeChannelStatus.ts` (consumer hook via `useSyncExternalStore`)
- `src/hooks/chat/useWhatsAppRealtime.ts` (modificado)
- `src/components/chat/RealtimeStatusBadge.tsx`
- `src/components/chat/view/ChatHeader.tsx` (renderiza badge)

**O que FALTA pra fechar**:
- Fallback polling: quando channel state off `joined` >2min, usar `useQuery` com `refetchInterval: 10s`
- Mecanismo de reconnect atual usa `dispatchEvent('focus')` — hacky, refazer via state/key trigger
- Test de reconnect (Vitest + fake timers)

### 5. Audit + telemetria — PARCIAL

Coluna `whatsapp_messages.received_via` (`webhook` default, `history_sync`, `dlq_replay`, `manual_replay`). Dashboard `/master/whatsapp-health`.

**Artefatos**:
- `supabase/migrations/20261012000006_whatsapp_messages_received_via.sql`
- `src/pages/master/MasterWhatsAppHealth.tsx`
- `src/components/master/MasterSidebar.tsx` (item "WhatsApp Health")
- `src/App.tsx` (rota `/master/whatsapp-health`)
- `supabase/functions/history-sync-worker/index.ts` (set `received_via='history_sync'`)
- `supabase/functions/whatsapp-webhook/index.ts` (lê `x-replay-source` header)

**O que FALTA pra fechar**:
- Botão "rebind manual" por instância no dashboard
- Botão "replay DLQ exhausted" no dashboard
- Gráfico drift histórico (timeseries 24h)
- Sentry tags estruturadas (`instance_id`, `org_id`, `provider`, `event_type`)

### 6. Contract tests Uazapi V2 — PARCIAL

14 testes cobrindo `pickInstanceId` / `pickUazapiToken` contra os 3 payload shapes V2 observados.

**Artefatos**:
- `tests/unit/uazapi-payload-resolution.test.ts`

**O que FALTA pra fechar**:
- E2E webhook → DB (POST com payload V2 → assert upsert + idempotência)
- Schema snapshot diário (cron amostrando 100 payloads/event_type + diffando contra ref)

## Gaps fora do plano original (impacto real)

### A. Mídia DLQ + retry — NÃO IMPLEMENTADO

`persistMediaToStorage` em `whatsapp-webhook` é fire-and-forget. ~10-30% mídias falham silenciosas (estimativa). CDN WhatsApp expira em ~14 dias.

**Fix**: tabela `whatsapp_media_jobs` + cron retry + alert quando >5 attempts.

### B. Mensagens de grupo — NÃO IMPLEMENTADO

`whatsapp-webhook/index.ts:400`: `if @g.us → skip`. Barulinho Bom tem grupo crítico ativo (`THAIS BARULHINHO CHIPS`). Decisão de produto necessária.

**Fix**: capturar com `is_group:true` + tela separada de grupos.

### C. Outbound monitoring — NÃO IMPLEMENTADO

V8 → Uazapi `/send/text` falhas silenciosas. Circuit breaker existe mas sem dashboard.

**Fix**: log estruturado por falha + card no dashboard mostrando taxa.

## Backlog priorizado pra fechar 100%

Ver `[[whatsapp-stability-100pct]]` no backlog em-progresso.

## Decisões registradas

- **Padrão webhook canônico**: `addUrlEvents:true`, URL=`/SECRET` (sem instance_id no path), `excludeMessages:["wasSentByApi"]`, events: `messages, messages_update, connection`. Definido em `UazapiProvider.reconfigureWebhook`. Não mexer sem teste regressivo.
- **Resolução defensiva**: cadeia `instance → instance_id → instanceId → InstanceId → InstanceID → instanceID → pathInstanceId → instanceName → InstanceName`. String vazia tratada como ausente. Fallback final por `uazapi_token`.
- **DLQ retention**: 5 attempts. Após exhausted, ficam no DB pra audit; não auto-deletados.
- **Auto-rebind cooldown**: 30min/instance. Evita rebind loop em caso de problema persistente.
- **Group messages**: dropados (decisão atual, B documenta reversão).

## 2026-09-11 — reconstrução em branch, sem rollout

Branch `codex/uazapi-rebuild` parte da main `23cbd6796`. Adapter traduz mídia/menu, usa criação documentada, filtra histórico por chatid e isola circuitos por credencial/servidor. Diagnóstico de limites mantém desconhecido como null. Fixture cobre campos das 139 operações; testes de contrato exercitam a superfície alterada.

Não homologado contra instância real. Ambiente Supabase e destinatário de teste pendentes. Estado verificável em `.specs/uazapi-rebuild/STATE.md`; referência de contrato em `docs/integrations/uazapi-rebuild.md`. Números históricos de cobertura acima não medem esta branch.

## Reconstrução isolada — rodada 2 (2026-09-11)

Branch `codex/uazapi-rebuild`: delays de disparo convertidos de ms para segundos, polling tolera falha transitória sem terminalizar job, nodes isolam destinatário/template por org e preservam recibos. Lista ganha rótulo configurável. Chat identifica seleção e mostra título em vez de ID. Testes reais no QA; sem promoção para produção. Estado, limitações e evidências em `.specs/uazapi-rebuild/STATE.md` e [[2026-09-11-uazapi-rebuild]].

## Rodada 6 — menus imediatos, playback e retomada

Listas do node e gateway persistem metadata mínima de exibição no envio (seções/títulos/descrições/rodapé/botão), sem IDs internos das escolhas. Insert-on-conflict preserva payload e recibos se o eco chegar antes. Front lê a projeção SQL ou o payload do Realtime; opções e resposta QA ESPERA verificadas no Chromium.

Áudio e PTT: readyState 4, duração 7,01 s e currentTime avançando. Vídeo estava com URL criptografada; helper recuperou MP4 para Storage (3.050 bytes, HTTP 200). Player reproduziu vídeo de 2 s. Não equivale a homologar transcrição.

Espera: resposta real recebida via SSE filtrado → webhook QA → ramo replied → completed. Timeout de 1 minuto também concluiu pelo ramo timeout, após prazo real. Nova chamada do worker não repete execução concluída.

Retry: falha 429 injetada antes do transporte revelou reserva de conteúdo suprimindo retry como falso sucesso. Executor agora fornece node/attempt e texto usa chave de replay por execução/nó/tentativa somente em retry; reserva inicial por conteúdo permanece. Worker retomou e persistiu uma única mensagem real. Falha 503 ambígua continua terminal. Menus, PIX e mensagem de campanha também classificam falhas ambíguas como não retentáveis.

Gateway unificado validado com override temporário apenas em QA e restaurado. Corrigido vínculo do log operacional: usa UUID de lead/instância, nunca ID composto do provider em coluna UUID. Catálogo QA ganhou flag desabilitada por padrão.

700 testes em 59 arquivos passaram. Build, Deno check, TypeScript e lint ratchets passaram sem novos problemas. Worker atualizado somente no QA; fluxos desta rodada desativados; cron segue inativo. Evidência: `live-verification-round6-2026-09-11.json`.

Lifecycle aguarda indicação de instância dedicada. Recuperação de mensagem ausente no histórico upstream, transcrição, publicação versionada do editor guiado e pré-requisitos de produção seguem separados desta homologação.

## Rodada 7 — publicação, cron, retomada e desempenho

Publicação pelo editor guiado retornou published/version 1. Versão antiga recusada com 409; usuário de outra organização com 403. Agendamento real pg_cron chamou worker QA e concluiu execução dessa versão; job se removeu após chamada, segredo temporário removido, zero crons ativos. Tentativa inicial de ativação por UPDATE direto foi corretamente recusada; ativação válida usou RPC autenticada.

Retomada de histórico agora atualiza o mesmo job failed → queued com compare-and-set, preservando cursor/contadores. Fixture interrompida no cursor 100 retomada pela interface. Encontrada contradição real da UAZAPI: offset 100 trouxe página cheia e hasMore=false, mas offset 200 continha mais 15 mensagens. Adapter passa a consultar próxima página quando a atual está cheia. Worker terminou com total 215, em vez de truncar em 200. Isso recupera omissão da paginação disponível; não prova recuperação de histórico ausente no próprio provider.

Transcrição via /message/download retornou texto não vazio usando configuração existente da instância; nenhuma chave foi alterada. QA não tem credenciais OpenRouter/Gemini. Persistência/apresentação integrada da transcrição no CRM ainda não homologada.

**Falha confirmada e ainda não corrigida: reentrada.** Workflow publicado com re_enrollment_enabled=false e execução concluída aceitou novo fire_trigger (triggered=1). Execução de teste cancelada e workflow desativado. Não confundir com proteção contra execução simultânea ou retry, que já foi testada. Este comportamento bloqueia homologação da reentrada.

Desempenho: conversa de 214 mensagens produziu duas respostas de 199.006 bytes de JSON decodificado na observação de 23 s; virtualização montou 11 itens. Zero chamadas do navegador ao provider nesse período. Janela máxima de 1.000 mensagens e backstop de 20 s são candidatos prioritários para paginação/reconciliação mais econômica. Não houve benchmark representativo de carga; análise em OPTIMIZACAO-CHAT.md.

711 testes em 60 arquivos passaram; build, Deno check e ratchets TypeScript/lint sem problemas introduzidos. CI remoto só apresenta Supabase Preview skipped; não certificado. Somente history-sync-worker atualizado em QA. Produção preservada.
