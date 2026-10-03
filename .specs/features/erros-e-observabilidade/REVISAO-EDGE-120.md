# Revisão das 120 edge functions que ficaram fora do go-live (2026-10-01)

Método: bundle de PROD baixado função a função (`functions download --use-api`; as que
importam `src/contracts/` pela Management API `/functions/{slug}/body` em multipart),
comparado arquivo a arquivo com `origin/main` (11573f8fc). Conteúdo diferente procurado
no histórico de blobs da main (só atrasada × drift). Dependências da versão da main
(RPC por `.rpc()`, tabela por `.from()`, segredo por `Deno.env.get`) cruzadas com o
catálogo e os segredos de PROD — contando só o que o deploy INTRODUZIRIA (ausente no
bundle que prod já roda).

## Resumo

| Classe | Qtde | Ação |
|---|---|---|
| Segura para deploy | 82 | deploy da main limpa em lotes (leva PRs já mergeados, ver abaixo) |
| Bloqueada por migration não aplicada | 24 | aplicar antes `20271021000028_uazapi_group_source_policy` (PR #2163) — senão o envio de WhatsApp quebra |
| Drift trivial (versão intermediária de PR já superada) | 6 | deploy após olhada do dono (billing é área frágil) |
| Drift real (código em prod fora da main) | 8 | NÃO deployar — mergear a origem antes |

## PRs que o deploy das seguras leva junto
Mergeados há semanas e nunca publicados nessas funções: #1547 (redação de PII nos logs),
#1523 (billing: payment_history), #1329 (log de runtime avisa quando falha), #1349 (portão
de tipo do `_shared`), #2163 (menos chamadas redundantes), #1156 (Send Governor em modo
sombra), #876 (observabilidade de inbound), #1050 (CORS dos headers de trace).

## Drift real — onde está a origem

- **forgot-password**: envio do e-mail de redefinição por SMTP Hostinger (`forgot-password/email.ts`, nodemailer) — só na branch `codex/fix-recovery-session`, **sem PR**. A main espera Resend (`RESEND_API_KEY`, `RESET_EMAIL_FROM`), que prod NÃO tem: deploy da main quebraria o 'esqueci minha senha'
- **support-notify-staff**: canal de aviso de chamado (`_shared/support-channel.ts`, 149 linhas) — PR #1955 aberto
- **infra-watchdog**: mesmo `_shared/support-channel.ts` — PR #1955 aberto
- **copilot-batch-processor**: confirmação de handoff (`_shared/copilot/handoff-receipt.ts`) — PR #2201 aberto (deployado hoje); a main também depende da migration 0028
- **agent-message**: handoff + ferramentas de CRM inline (7 arquivos) — PR #2201 aberto; a main também depende da migration 0028 e de tabelas ausentes
- **toth-sync-pedidos**: configuração de fluxo do Toth (`configure_flow`, credenciais) fora da main; a main chama `toth_find_owned_preorder` (migration 20271021000021, não aplicada)
- **whatsapp-api-proxy**: provider Uazapi anterior ao #2163 (webhook com `excludeMessages`); a main depende da migration 0028
- **whatsapp-rebind-webhook**: idem whatsapp-api-proxy

## Bloqueadas por migration (24)

`blast-plan-create`, `blast-plan-release`, `calculate-portfolio-health`, `campaign-rule-dispatch`, `carteira-bulk-message`, `copilot-v2-worker`, `history-sync-worker`, `mass-send-control`, `mass-send-create`, `mass-send-status`, `notificame-send-social`, `notificame-templates`, `outbound-trigger`, `pipe-rule-dispatch`, `process-ai-actions`, `process-blast-recipients`, `process-copilot-followups`, `process-followup-situations`, `process-outbound-dispatches`, `process-scheduled-user-messages`, `process-workflow-executions`, `quick-blast-create`, `recover-stuck-conversations`, `semi-automatic-dispatch`

As RPCs `prepare/request/finish_uazapi_group_*` (migration 0028, PR #2163) não existem em
prod — nem no ledger. `process-workflow-executions` também referencia
`scheduled_date_dispatch_log` e `workflow_split_*`, ausentes.

## Drift trivial (6)

`asaas-webhook`, `billing-payment-link`, `billing-provision-worker`, `create-gestor`, `manage-gestor-orgs`, `toth-sync-cobrancas` — as linhas só-em-prod são versões anteriores
do boundary, do logger e do `auth.ts` que a main já substituiu.

## Seguras (82)

`admin-reset-user-password`, `blast-plan-control`, `blast-plan-edit`, `classify-followup-stages`, `copilot-builder`, `copilot-quote-template`, `create-org-user`, `elevenlabs-proxy`, `erp-order-webhook`, `evaluate-agent-conversation`, `generate-agent-examples`, `generate-business-context`, `generate-custom-instructions`, `generate-faqs`, `get-automation-jobs`, `get-lead-timeline`, `get-member-permissions`, `google-calendar-callback`, `google-calendar-connect`, `google-calendar-disconnect`, `google-calendar-sharing`, `list-lead-forms`, `list-organizations`, `meeting-calendar-sync`, `meta-ads-insights`, `meta-asset-admin`, `meta-conversation-profile`, `meta-conversion-dispatch`, `meta-embedded-signup-exchange`, `meta-oauth-callback`, `meta-oauth-start`, `meta-template-create`, `meta-template-list`, `meta-template-sync`, `notificame-channel-finish`, `notificame-channel-start`, `notificame-subscription-repair`, `omie-connect`, `omie-disconnect`, `omie-sync-clientes`, `omie-sync-financeiro`, `omie-sync-pedidos`, `omie-sync-produtos`, `omie-webhook`, `onboarding-advance`, `partner-webhook`, `process-agent-document`, `process-followup-automations`, `process-webhook-deliveries`, `publish-guided-workflow`, `refresh-meta-tokens`, `remove-org-member`, `reset-password`, `retry-dead-letter-jobs`, `save-member-permissions`, `stream-media`, `suggest-retention-action`, `sz-chat-send`, `test-guided-condition`, `tinyerp-connect`, `tinyerp-disconnect`, `tinyerp-fetch-nfe`, `tinyerp-proxy`, `tinyerp-pull-orders`, `tinyerp-push-order`, `tinyerp-push-upsell-order`, `tinyerp-sync-contacts`, `tinyerp-sync-products`, `tinyerp-webhook`, `torquecalls-control`, `torquecalls-recording-maintenance`, `torquecalls-webhook`, `toth-connect`, `toth-probe`, `webhook-send-test`, `whatsapp-dlq-replay`, `whatsapp-instance-reaper`, `whatsapp-instance-reconcile`, `whatsapp-media-purge`, `whatsapp-media-retention`, `whatsapp-session-watchdog`, `workflow-question-image`
