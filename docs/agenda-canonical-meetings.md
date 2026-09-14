# Reuniões canônicas na agenda

A agenda mostrava atividades de `meetings` junto com projeções de `meeting_events`
e `pipe_confirmacao`. Somente a primeira fonte oferecia presença. Na Milennials,
James Ernica estava na primeira; Alex Filippini Taboada e Lilian Marescalchi nas
outras. A migração histórica anterior copiou registros, mas não fechou o escritor
antigo: um trigger continuava inferindo agendamento e comparecimento de etapas.

## Contrato

- Reunião agendada é uma linha `meetings`, com `event_type=meeting`.
- Mover negócio de etapa não agenda reunião nem registra comparecimento/falta.
- Definir explicitamente data no negócio é uma operação de agendamento. O adaptador
  de compatibilidade grava em `meetings`, sem interpretar nome/papel da etapa.
- `meeting_events` permanece como livro de métricas. `booked_event_id` mantém o
  vínculo exato mesmo quando uma reunião muda de data. Um agendamento possui no
  máximo um desfecho; repetir o mesmo resultado não recria evento de workflow.
- Ligações, tarefas, follow-ups e outros tipos não oferecem presença.
- Não se deduz falta porque o horário passou. Registros novos sem desfecho ficam
  sem registro. Desfechos históricos existentes são preservados.
- O card reinicia estado ao trocar evento e acompanha alterações vindas de refetch.

## Entradas

| Entrada | Persistência |
| --- | --- |
| Agenda e ação de criar reunião | `meetings` |
| Edição explícita de data no negócio | Adaptador transacional para `meetings` |
| `meeting-webhook` | `meetings`; `meeting:write`; organização da API key |
| Cal.com `BOOKING_CREATED` | `meetings`; organização configurada; sem criação/movimento de negócio |
| Copilot / ação de workflow `schedule_meeting` | `meetings`; referência idempotente para retries |

API de reunião já existia: `POST /functions/v1/meeting-webhook`, Bearer API key,
campos `title`, `start_at`, `end_at`, opcionais `lead_id`, `assigned_to`,
`external_ref`. Tipo padrão `meeting`. `external_ref` evita duplicação na organização.
Corrigidos ID do criador (FK `auth.users`), validação de referências por organização
e seleção de `expires_at` para efetivamente verificar expiração da chave.

Cal.com exige segredo de assinatura existente e `CALCOM_ORGANIZATION_ID` no backend.
A configuração identifica a organização atendida por esse endpoint. Sem configuração,
resposta 500 antes de criar lead ou reunião. Não adivinhar organização em banco multi-tenant.

## Histórico e validação

Leitura de produção em 2026-09-14: 43 bookings com data sem correspondente em
`meetings`, 37 da Milennials; nenhum par repetido entre esses candidatos. Migração
materializa histórico, preserva eventos de métrica e evita disparar automações
antigas. Inclui registros com data sem booking e follow-ups antigos tipados como
reunião. Registros sem data permanecem somente no livro histórico; nenhuma data é inventada.

Ensaio `node scripts/test-canonical-meetings.mjs <preview-ref>` executa corpos reais
sobre fixtures em schema isolado, incluindo migração e rollback. Usa transação e
ROLLBACK; não altera schema público nem dados da preview. Testa preservação do
livro histórico, remarcação, ausência de efeitos por etapa, desfechos idempotentes,
negócios distintos e rejeição de referências entre organizações. Não substitui
smoke autenticado em ambiente com dados representativos.

## Rollout

1. Revisar e aplicar somente `20271021000005_canonical_pipeline_meetings.sql`.
   Não usar `db push` indiscriminado: existe drift histórico no ledger.
2. Configurar `CALCOM_ORGANIZATION_ID` para a organização contratante da integração,
   antes de publicar `webhook-calcom`.
3. Publicar `meeting-webhook`, `webhook-calcom` e consumidores das ações compartilhadas
   (`agent-message`, `process-ai-actions`, `process-copilot-followups` e
   `process-workflow-executions`, identificados pelo grafo de imports).
   `test-workflow-system` também depende desses módulos quando esse endpoint estiver habilitado.
4. Publicar frontend após review/merge. Confirmar James, Alex e Lilian na agenda,
   trocar cards e resultado, conferir contagens; nenhum teste de escrita em clientes
   reais sem autorização.

Produção não foi alterada nesta implementação. Rollback SQL restaura escritores e
leitores anteriores sem apagar reuniões criadas desde a publicação; colunas novas
permanecem para preservar rastreabilidade. Reverter também os artefatos de frontend
/ edge da mesma publicação. Não remover dados de clientes como parte do rollback.
