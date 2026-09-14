---
title: Reuniões canônicas e presença na agenda
created: 2026-09-14
status: active
type: changelog
---

Reuniões passam a ser contabilizadas pela agenda em `meetings`. O escritor de eventos
por mudança de etapa é desanexado; agendamento explícito mantém adaptador para os
editores de data existentes. API, Copilot, workflow e Cal.com usam a mesma tabela.
Presença fica restrita a reuniões. Corrigido estado do popover ao trocar evento.

Migração reconcilia histórico sem inventar falta nem repetir eventos de automação.
Implementação e ensaio concluídos; publicação em produção depende de autorização.
Detalhes: `docs/agenda-canonical-meetings.md`.

## Publicação em produção

- Autorização: Gabriel, nesta sessão, “pode aplicar”, após merge do PR #2109.
- Commit publicado: `037f10acdcde3cde9205c3ce196c144f51080564`.
- Projeto: `jsjsmuncfkbsbzqzqhfq`.
- SQL aplicado em 2026-09-14 14:47:47 UTC. Ledger remoto: versão
  `20260914144747`, nome `canonical_pipeline_meetings`. Nome do arquivo aprovado:
  `20271021000005_canonical_pipeline_meetings.sql`; não reaplicar por diferença de versão.
- SHA-256: `d0a55ef10831d087dec2117ebff24debd4c862fc3a3b3d45cdb3cd068171d2bb`.
- Antes: 940 atividades, 1.889 eventos. Imediatamente após: 1.017 atividades,
  mesmos 1.889 eventos. Backup local de dados, definições SQL e versões das funções
  capturado antes da aplicação; rollback SQL previamente executado em transação de ensaio.
- Publicadas: `meeting-webhook` v47, `webhook-calcom` v63, `agent-message` v269,
  `process-ai-actions` v125, `process-copilot-followups` v131,
  `process-workflow-executions` v161, `test-workflow-system` v65.
- `CALCOM_ORGANIZATION_ID` configurado para Milennials, única organização encontrada
  no histórico de eventos Cal.com. Preservadas configurações JWT existentes.
- James, Alex e Lilian retornam `source=meeting`, `event_type=meeting` na RPC da agenda.
  Nenhum booking com data sem reunião correspondente; nenhum vínculo de booking
  quebrado; nenhum trigger de reuniões desabilitado; escritor por etapa ausente.
- Nenhum evento histórico apagado. Verificação posterior detectou uma remarcação
  e dois agendamentos reais após deploy, todos pela fonte `agenda:meeting`.
- Respostas sem credenciais: HTTP 401 nos dois endpoints de entrada. Nenhuma
  presença de cliente foi alterada como teste. Smoke de criação com credenciais
  externas e interação visual autenticada não executados nesta publicação.
- Nota de dados anterior ao deploy: um booking conserva data diferente da reunião,
  mas está ligado pelo ID exato; não foi duplicado nem teve histórico reescrito.
- Imagem de frontend do merge gerada com sucesso. Site respondeu HTTP 200;
  isso não substitui validação visual autenticada.
