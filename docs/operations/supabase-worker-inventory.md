# Inventário de workers e crons — 2026-09-23

## Evidência e limites

Leitura de produção jsjsmuncfkbsbzqzqhfq em 23/09/2026 22:23–22:25 UTC: cron.job, corpos de invoke_* e RPCs de claim; código local na branch de capacidade. Nenhum comando de cron, segredo, identificador de cliente ou payload privado foi publicado. Números de agendamento abaixo são oportunidades máximas, **não economia medida**. SQL puro não é invocação Edge; pg_net agendado com sucesso tampouco prova HTTP bem-sucedido.

71 crons ativos; 15 por minuto; 39 entradas chamam invoke_*. Os 15 incluem SQL puro, como manutenção VoIP. Consulta de histórico com filtro de sete dias retornou somente 22/09 03:17 até 23/09 22:24 UTC: 56.073 execuções, 126 falhas SQL. Retenção curta impede extrapolar sete dias como medidos. Cada job por minuto teve ~2.587 execuções nesse recorte. Não ler status SQL como sucesso do worker: vários invokers engolem exceções e HTTP é assíncrono.

A documentação antiga de functions/CLAUDE.md está defasada: process-followup-situations possui cron ativo (id66), contrariando comentário de rollout pendente. Inventário vivo prevalece.

## Oportunidades além das cinco iniciais

| Worker | Agenda / máximo em 30 dias | Predicado e proteção a preservar |
|---|---:|---|
| copilot-v2-worker | minuto / 43.200 | pending OU retry com next_retry_at nulo/vencido; claim com SKIP LOCKED, lote10. Não remover feature por fila vazia. |
| oraculo-feedback-worker alerts | minuto / 43.200 | pending due OU processing com lease vencido. Preservar modo weekly independente. Lote20, retries/backoff. |
| pipe-rule-dispatch | minuto / 43.200 | scheduled vencido OU waiting_response expirado OU processing com scheduled_at anterior a 2min; recovery acontece antes da seleção. |
| campaign-rule-dispatch | minuto / 43.200 | scheduled vencido OU waiting_response expirado; guarda conservadora inclui processing antigo. Recovery existente só dentro de campanha selecionada, defeito herdado a investigar separadamente. |
| process-blast-recipients | minuto / 43.200 | destinatário pending com claimed_at nulo ou antigo10min, lote liberado, plano active com template, instância notificame. Lote20 e teto5 por org; preservar ritmo3s. |
| workflow-cron-triggers | minuto / 43.200 | não é worker separado: process-workflow-executions modo cron_triggers; pode pular apenas sem workflows ativos dos três tipos periódicos. Não mudar tempos de negócio. |
| mass-send-status | 2min / 21.600 | uazapi_sender_jobs queued/running, lote50. |
| whatsapp-media-retry | 2min / 21.600 | resolved_at nulo e attempts<5; lote50; preservar tratamento de grupos. |
| whatsapp-dlq-replay | 5min / 8.640 | resolved_at nulo e attempts<5; lote100; cada replay aciona webhook, amplificação intencional limitada. |
| billing-provision-worker | 2min / 21.600 | anti-join com livro de provisionamento para org existente E links pagos new_org; não basta olhar assinaturas. Requer revisão payment e evitar starvation de limite anterior ao filtro. |
| summarize-conversations-batch | 10min / 4.320 + filhos | claim cria trabalhos a partir de conversas sem resumo/obsoletas e recupera leases. Checar somente fila atual impediria criação futura. |
| process-outbound-dispatches, process-copilot-followups, process-followup-automations, retry-dead-letter-jobs, process-followup-situations | 5min / 8.640 cada | candidatos posteriores; inventariar recuperação, detecção de incidentes e reclassificação antes de guarda. |

Snapshot 22:24 UTC: copilot_v2_message_queue total0/due0; whatsapp_media_jobs total37.336/due0; whatsapp_webhook_dlq total218/due0; uazapi_sender_jobs total11/due0. É somente snapshot, não percentual histórico vazio. Primeiros quatro candidatos simples (copilot-v2, mass-status, media-retry, DLQ) somam 95.040 chamadas/mês de teto de agenda; economia real depende da ocupação futura.

Fontes exatas: copilot-v2-worker/index.ts:31,51; mass-send-status/index.ts:222; whatsapp-media-retry/index.ts:79; whatsapp-dlq-replay/index.ts:160; pipe-rule-dispatch/index.ts:158; campaign-rule-dispatch/index.ts:114; process-blast-recipients/index.ts:55,113; _shared/blast-official-runner.ts:205; migrations/20270824000000_blast_official_worker.sql:72; migrations/20271019153000_oraculo_feedback_master.sql:357; process-workflow-executions/index.ts:531,577,647. Caminhos de funções relativos a supabase/functions/.

## Fanout existente e desperdícios observáveis

- cron-health-check/index.ts:34 chama process-workflow-executions com noop_probe a cada5min: até8.640 chamadas extras/mês. Handler original não reconhecia modo e caía em recovery/claim real. Retorno autenticado corrige trabalho de banco, mas não economiza invocação; manter monitoramento de autenticação.
- Oráculo: crons admin/member executam SQL, não oraculo-briefing. Edge briefing é consultada por Sidebar.tsx:80 usando useOraculoBriefing.ts. Antes, enabled apenas verificava identidade, não plano; staleTime60s e retry padrão. Auditoria HTTP do agente principal: 954 chamadas/24h,670 respostas403. Gate de feature resolvida e supressão de retries4xx removem consultas conhecidamente negadas; autorização permanece no servidor. Não prometer eliminar todos670: outros motivos403 continuam possíveis.
- summarize-conversations-batch/index.ts:50 chama summarize-conversation por item, padrão10/máximo20 (_shared/oraculo/summary-batch.ts:19). Até43.200 filhos/30d no lote padrão se sempre cheio, além4.320 pais. Consolidar serviço compartilhado é possibilidade posterior; preservar autenticação, idempotência e leases. Claim também descobre conversas novas; fila vazia não autoriza desativar agendamento.
- copilot-batch-processor/index.ts:145–176 já combina mensagens em uma chamada agent-message e verifica IA desligada/humano. Não acrescentar atraso de batching sem decisão sobre latência.
- agent-message/index.ts:769–776 já avalia conversa a cada3turnos, não todo turno. Ajustar amostragem muda observabilidade de IA; requer decisão explícita.
- whatsapp-webhook → agent-message; sz-chat-webhook → agent-message e sz-chat-send; partner-webhook → lead-webhook → outbound-trigger; tinyerp-webhook → tinyerp-fetch-nfe; recovery e retries também acionam funções. Não colapsar fronteiras sem medir chamadas por mensagem comercial concluída.
- retry-dead-letter-jobs/index.ts:34–35,340–377 já limita ressurreição IA a24h/5tentativas e preserva retry_count. Cron também detecta padrões dead-letter: guarda de fila somente seria incompleta.
- invoke_omie_sync_dispatch já distribui orgs em30buckets, até4chamadas/org a cada30min: até5.760/mês/org. invoke_toth_sync chama por org conectada, clientes/hora+cobranças/2h:1.080/mês/org. São custos proporcionais ao uso, não uma chamada por tick global.
- invoke_followup_reclassify já exige filas antigas5min, até20orgs/tick. invoke_notificame_subscription_repair já exige assinatura de entrada pendente/falha e due. Melhorar COUNT para EXISTS pode poupar banco, mas não elimina chamadas vazias já evitadas.
- Watchdogs, saúde de WhatsApp e infra não dependem de fila: detectar falha exige consulta periódica. Não desligar nem reduzir cadência como primeira medida de economia.

## Grupos Uazapi: proposta de filtro na origem, ainda não aplicada

Janela de 22/09 22:00 a 23/09 22:00 UTC: **12.175 registros** `uazapi_group_message_skipped` em `runtime_logs`. São mensagens/eventos descartados, não uma medição de chamadas faturadas: um webhook pode carregar mais de uma mensagem e retries podem repetir eventos. Não multiplicar esse número por 30 como economia garantida. O ganho deverá ser medido por requisições HTTP antes/depois, por instâncias equivalentes, separando mensagens diretas e grupos.

A [documentação oficial Uazapi no Postman](https://www.postman.com/augustofcs/uazapi-v2/request/so8w6vz/definir-webhook) expõe `excludeMessages` e o filtro `isGroupYes` em `POST /webhook`, configurado por instância. Nosso provider configura apenas `wasSentByApi`. Portanto, o fornecedor entrega grupos que o webhook paga para receber, consulta a preferência e descarta.

Snapshot das instâncias Uazapi: **130 pertencem a organizações com `capture_groups = false`; 6 a organizações com `true`**. Isso inclui estados diversos de conexão; não representa 136 instâncias ativas. Aplicar filtro global perderia grupos de organizações habilitadas.

Caminhos que precisam mudar juntos numa entrega futura:

| Caminho | Estado atual | Requisito para filtrar com segurança |
|---|---|---|
| `_shared/whatsapp-providers/uazapi-provider.ts:165` — criação | Filtro fixo `wasSentByApi` | Ler preferência da organização no servidor; adicionar `isGroupYes` somente com `false` confirmado |
| Mesmo arquivo, `reconfigureWebhook`, linha 505 | Reescreve filtro fixo | Usar a mesma política da criação; rebind não pode apagar o filtro nem bloquear organização habilitada |
| Mesmo arquivo, `readWebhook`, linha 522 | Normaliza somente URL e enabled | Normalizar também filtros, eventos e identidade da configuração; comparar configuração persistida, não confiar apenas em HTTP 200 |
| `whatsapp-rebind-webhook/index.ts:196` | Reconfigura e verifica URL/enabled | Verificar filtros esperados e versão da preferência; preservar URL/segredo e demais eventos |
| `whatsapp-api-proxy/index.ts:991` | Ação manual reconfigureWebhook | Reutilizar política comum e leitura posterior |
| `whatsapp-health-monitor/index.ts:57` | Pode acionar rebind automaticamente | Rebind deve manter preferência; métrica de saúde não deve acusar falta de grupos que foram excluídos intencionalmente |
| `whatsapp-webhook/index.ts:946` | Lê `capture_groups` e descarta grupos; erro de leitura permite captura | Manter proteção atual no servidor, mesmo com filtro na origem |

Busca no código não encontrou formulário/RPC dedicado para alterar `capture_groups`. As escritas encontradas são migrations e rollback, além da possibilidade operacional de alteração direta. Nenhum fluxo sincroniza uma mudança dessa coluna com Uazapi. Não existe `ensureWebhook` separado nesta implementação: criação, reconfigure manual e rebind são os pontos reais. Trocar apenas o array do provider deixaria organizações religando captura sem receber mensagens.

Proposta de sincronização:

1. Resolver política comum no servidor. Sem organização válida, erro de leitura ou preferência desconhecida: não acrescentar filtro de grupos. Preservar `wasSentByApi`, eventos de mensagem, atualização e conexão.
2. Mudança de preferência cria reconciliação durável por instância, com versão e execução serializada; usar fila e entrega orientada a evento, com recuperação existente, evitando novo cron que chama Edge vazio.
3. Ao desabilitar captura, gravar preferência e depois aplicar filtro remoto. Se fornecedor falhar, proteção atual continua descartando grupos; economia fica pendente e visível.
4. Ao habilitar captura, remover filtro remoto e verificar persistência antes de anunciar conclusão. Estado de sincronização precisa continuar pendente em erro; alterações concorrentes exigem comparação de versão e reconciliação da intenção mais recente. Não declarar sucesso com `capture_groups = true` enquanto remoto permanece bloqueando grupos.
5. Para instâncias existentes: listar apenas Uazapi, resolver preferência atual por organização, executar lote pequeno e registrar resultado sem URLs com segredo. Configuração remota deve ser atualizada pelo ID correto, sem criar webhooks duplicados. Primeiro validar numa instância controlada o ciclo desabilitar → habilitar → grupo recebido; só depois reconciliar restantes. As seis instâncias com captura habilitada ficam sem filtro de grupos.

Não aplicado neste pacote. Rollback futuro remove somente `isGroupYes`, preserva os demais filtros e confirma read-back. Qualquer falha de read-back permanece não verificada; nunca é contada como economia realizada.

## Falhas repetidas: causa e tratamento

**Convites:** `attach-to-org-by-pending-invite` versão 89 em produção era idêntica ao código local. Lia `data.id` e `data.email` de `auth.getUser()`, mas Supabase JS v2 retorna `data.user`; consequentemente chegava ao 401 mesmo após autenticação válida. Janela medida pelo agente principal: 477 chamadas, todas 401. Corrigido envelope; mantém validação no Auth, organização exclusivamente do convite persistido e corpo da requisição sem autoridade sobre identidade/organização. Cinco testes com SDK real cobrem usuário válido sem convite, vínculo autorizado, JWT inválido, e-mail ausente e Bearer ausente. Essa correção recupera funcionalidade; não elimina a chamada legítima de vínculo. Não alterar fluxo de login nem esconder erro como sucesso.

**Resumos:** 144 respostas 500 na janela de 24 horas; os logs da função registram falha ao reservar conversas. Os mesmos 144 erros Postgres apontam `claim_conversation_summary_jobs(integer) line 3`, SQLSTATE de coluna ambígua: `organization_id` pode ser variável OUT ou coluna em `ON CONFLICT (organization_id, lead_id, instance_id)`. Constraint real confirmada: `conversation_summary_jobs_organization_id_lead_id_instance__key`. Correção proposta usa `ON CONFLICT ON CONSTRAINT`, sem mudar claim, leases ou grants.

**Não aplicar correção de resumos no rollout de economia:** a consulta de elegibilidade encontrou **25.900 conversas**, com zero jobs na fila. Restaurar o worker pode gerar até 1.440 chamadas filhas por dia, ou 43.200 em 30 dias no lote atual, além de uso de IA. Isso é restauração de serviço quebrado, não economia. SQL e rollback ficam em `docs/operations/proposals/summary-claim-fix.sql` e `summary-claim-fix-rollback.sql`, fora das migrations ativas. Teste isolado reproduz erro original e valida descoberta, retry futuro/vencido, recuperação de lease, limite de lote, grupos excluídos, cache de resumo atualizado e grants. A ativação exige orçamento e tratamento controlado do backlog. Cron e feature não foram desligados.

## Orçamento operacional

1,4 milhão é orçamento operacional proposto: 70% da franquia de 2 milhões, reservando 600 mil para picos, retries e crescimento. Não é limite Supabase nem economia comprovada. Medir ciclo inteiro e soma de projetos; guarda de cron poupa parcela fixa, webhooks seguem crescimento do negócio. Para crescer, acompanhar invocações por mensagem útil, por organização ativa, taxa de duplicata/erro, atraso de fila e crescimento de disco. Atualizar previsão diariamente com janelas de 7 e 30 dias quando houver retenção suficiente.

## Inventário completo da agenda viva

| ID | Job | Agenda | Entrada identificada |
|---|---|---|---|
| 2 | process-outbound-dispatches | `*/5 * * * *` | invoke_process_outbound_dispatches |
| 3 | process-copilot-followups | `*/5 * * * *` | invoke_process_copilot_followups |
| 4 | process-followup-automations | `*/5 * * * *` | invoke_process_followup_automations |
| 6 | purge-deleted-whatsapp-conversations | `0 3 * * *` | SQL / verificar fanout indireto |
| 11 | cleanup_usage_events_180d | `0 4 * * *` | SQL / verificar fanout indireto |
| 13 | cleanup-automation-jobs | `0 2 * * *` | SQL / verificar fanout indireto |
| 14 | retry-dead-letter-jobs | `*/5 * * * *` | invoke_retry_dead_letter_jobs |
| 23 | refresh-meta-tokens | `0 2 * * *` | invoke_refresh_meta_tokens |
| 39 | cron-health-monitor | `2-59/5 * * * *` | SQL / verificar fanout indireto |
| 40 | pgnet_response_cleanup | `0 3 * * *` | SQL / verificar fanout indireto |
| 41 | cron_health_check | `*/5 * * * *` | invoke_cron_health_check |
| 45 | mass-send-status-poll | `*/2 * * * *` | invoke_mass_send_status |
| 47 | whatsapp_dlq_replay | `*/5 * * * *` | invoke_whatsapp_dlq_replay |
| 48 | whatsapp_session_watchdog | `*/10 * * * *` | invoke_whatsapp_session_watchdog |
| 49 | whatsapp_health_monitor | `*/5 * * * *` | invoke_whatsapp_health_monitor |
| 51 | whatsapp_media_retry | `*/2 * * * *` | invoke_whatsapp_media_retry |
| 52 | cleanup-copilot-batching | `0 3 * * *` | SQL / verificar fanout indireto |
| 54 | copilot_v2_worker | `* * * * *` | invoke_copilot_v2_worker |
| 55 | blast-plan-release | `5 12 * * *` | invoke_blast_plan_release |
| 56 | followup-reclassify | `*/5 * * * *` | invoke_followup_reclassify |
| 58 | process-ai-actions | `* * * * *` | invoke_process_ai_actions |
| 59 | process-workflow-executions | `* * * * *` | invoke_process_workflow_executions |
| 60 | workflow-cron-triggers | `* * * * *` | invoke_workflow_cron_triggers |
| 61 | campaign-rule-dispatch | `* * * * *` | invoke_campaign_rule_dispatch |
| 62 | pipe-rule-dispatch | `* * * * *` | invoke_pipe_rule_dispatch |
| 63 | process-scheduled-user-messages | `* * * * *` | invoke_process_scheduled_user_messages |
| 64 | history-sync-worker | `* * * * *` | invoke_history_sync_worker |
| 65 | calculate-portfolio-health | `21-59/30 * * * *` | invoke_calculate_portfolio_health |
| 66 | process-followup-situations | `*/5 * * * *` | invoke_process_followup_situations |
| 67 | cron-job-run-details-retention | `17 3 * * *` | SQL / verificar fanout indireto |
| 73 | agent-decision-logs-retention | `23 3 * * *` | SQL / verificar fanout indireto |
| 75 | raw-payload-retention | `33 3 * * *` | SQL / verificar fanout indireto |
| 77 | whatsapp-dlq-retention | `43 3 * * *` | SQL / verificar fanout indireto |
| 78 | purge-deleted-leads-log | `17 3 * * *` | SQL / verificar fanout indireto |
| 80 | meta-leadgen-poll | `*/5 * * * *` | invoke_meta_leadgen_poll |
| 81 | meta-conversion-dispatch | `*/10 * * * *` | invoke_meta_conversion_dispatch |
| 82 | cleanup-audit-log-14d | `6-59/10 * * * *` | SQL / verificar fanout indireto |
| 83 | cleanup-wa-health-checks-7d | `4-59/10 * * * *` | SQL / verificar fanout indireto |
| 84 | cleanup-wa-media-jobs-14d | `13-59/15 * * * *` | SQL / verificar fanout indireto |
| 85 | copilot-queue-sweep | `* * * * *` | SQL / verificar fanout indireto |
| 87 | tinyerp-pull-orders-basic4u | `*/15 * * * *` | HTTP direto |
| 90 | purge-runtime-logs | `9-59/10 * * * *` | SQL / verificar fanout indireto |
| 91 | whatsapp_media_retention | `0 4 * * *` | invoke_whatsapp_media_retention |
| 92 | close-resolved-support-tickets | `20 4 * * *` | SQL / verificar fanout indireto |
| 93 | omie-sync-dispatch | `* * * * *` | invoke_omie_sync_dispatch |
| 94 | send-dedup-log-cleanup | `*/5 * * * *` | SQL / verificar fanout indireto |
| 96 | voip-sweep-stuck-calls | `* * * * *` | SQL / verificar fanout indireto |
| 99 | history-sync-budget-cleanup | `3-59/15 * * * *` | SQL / verificar fanout indireto |
| 100 | infra-watchdog | `*/2 * * * *` | invoke_infra_watchdog |
| 101 | whatsapp_instance_reaper | `*/5 * * * *` | invoke_whatsapp_instance_reaper |
| 106 | purge-copilot-midia-logs | `8-59/15 * * * *` | SQL / verificar fanout indireto |
| 107 | billing-provision-worker | `*/2 * * * *` | invoke_billing_provision_worker |
| 109 | notificame-subscription-repair | `*/5 * * * *` | invoke_notificame_subscription_repair |
| 139 | voip-reap-authorized | `* * * * *` | SQL / verificar fanout indireto |
| 140 | voip-webhook-events-cleanup | `*/5 * * * *` | SQL / verificar fanout indireto |
| 141 | torquecalls-recording-maintenance | `3-59/5 * * * *` | invoke_torquecalls_recording_maintenance |
| 142 | inv5-public-tables-readable-by-anon | `17 4 * * *` | SQL / verificar fanout indireto |
| 143 | toth-sync-clientes | `0 * * * *` | invoke_toth_sync |
| 144 | toth-sync-cobrancas | `15 */2 * * *` | invoke_toth_sync |
| 146 | process-blast-recipients | `* * * * *` | invoke_process_blast_recipients |
| 151 | avisos-varredura-followups | `0 10 * * *` | SQL / verificar fanout indireto |
| 152 | avisos-varredura-reuniao-proxima | `*/15 * * * *` | SQL / verificar fanout indireto |
| 153 | send-push | `* * * * *` | invoke_send_push |
| 154 | avisos-limpeza-semanal | `0 7 * * 0` | SQL / verificar fanout indireto |
| 155 | summarize-conversations-batch | `7-59/10 * * * *` | invoke_summarize_conversations_batch |
| 156 | oraculo-feedback-alerts | `* * * * *` | invoke_oraculo_feedback_worker |
| 157 | oraculo-feedback-weekly | `0 12 * * *` | invoke_oraculo_feedback_worker |
| 158 | oraculo-benchmark-weekly | `15 13 * * 1` | SQL / verificar fanout indireto |
| 159 | oraculo-admin-briefing | `*/5 * * * *` | SQL / verificar fanout indireto |
| 160 | oraculo-admin-briefing-shrinkage | `7,22,37,52 * * * *` | SQL / verificar fanout indireto |
| 161 | oraculo-member-briefing | `*/5 * * * *` | SQL / verificar fanout indireto |

## Validação e segurança

### Expansão implementada: migration27

Guardas para pipe-rule-dispatch, campaign-rule-dispatch, process-blast-recipients e modo alerts do feedback. Código dos quatro workers e helpers blast/feedback comparado byte a byte com versões instaladas: todos iguais. Invokers e claims foram lidos diretamente de produção; rollback preserva corpos originais e grants existentes service_role-only. Agendas, rate limits e claims não mudam. Weekly ignora guarda de alertas; campanha usa guarda conservadora para processing antigo sem tentar corrigir recuperação herdada nesta entrega.

Snapshot adicional em 23/09: pipe516linhas, campaign242, feedback0 e blast420(com joins planos/instâncias), todos com zero elegíveis, timeouts e recuperações naquele instante. Não prova histórico vazio. EXPLAIN ANALYZE das quatro sondas SELECT em produção: pipe0,276ms; campaign0,970ms; feedback0,113ms; blast0,170ms (execução única, não percentis). Duas sondas de recovery ainda faziam varredura: pipe processing e feedback lease. Migration adiciona índices parciais só para processing; demais predicados já usam índices existentes. Não foram aplicados em produção.

Teste executável `tests/integration/cron-idle-campaigns.test.mjs`: PostgreSQL embutido PGlite, HTTP substituído por coletor local. Cobre vazio/futuro/vencido, waits vencidos, recovery, weekly independente, grant negativo anon/authenticated, plano pausado, template ausente, lote não liberado, provider errado, claim recente/abandonado, nenhuma mutação de fila, rollback/reapply. Biblioteca estava ausente no node_modules local; execução usou mesma versão instalada isoladamente em /tmp, sem alterar dependências do projeto. Isso valida PL/pgSQL, não substitui preview Supabase, pg_net real nem teste de carga.

Sem alteração de produção neste inventário. Para cada guarda: testar vazio, futuro, vencido, recuperação de lease, lote/concorrência e privilégios. Replica fiel de predicado de claim é pré-filtro, não substitui claim atômico. Frontend só economiza chamadas; não substitui autenticação/plan gate no servidor. Cache de briefing mantém organização e usuário na chave e oculta dados ao perder entitlement. Retenção comercial, cadência de monitores e polling ERP ficam fora das mudanças automáticas.
