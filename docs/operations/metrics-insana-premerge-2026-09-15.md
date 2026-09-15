# Revisão antes do merge — métricas e exportação

PR: [#2117](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/2117).

Base examinada: `54536f8380b435d51acaf8cea90ead2bb351c890`. A main foi integrada à branch de correção sem conflitos. Os testes locais abaixo executaram o código combinado, incluindo os ajustes recentes de propostas e comissões da main. O PR não foi integrado à main e não houve deploy.

## Standards

Nenhuma violação obrigatória confirmada nas regras de AGENTS.md, CONTRIBUTING.md, analytics/CLAUDE.md e nos contratos de métricas consultados. Organização permanece nas consultas e nas chaves de cache; não há alterações de schema, RLS, auth, Edge Functions ou dos cálculos de receita no diff do PR.

Dois riscos de disponibilidade foram encontrados e corrigidos:

1. A consulta de resposta de WhatsApp era obrigatória para carregar todos os indicadores. Agora `useTeamResponseTime` tem estado e cache próprios e só é usado pelo card de resposta. Timeout e consulta pendente não impedem leads, receita, metas ou performance.
2. A exportação existente de abas com métricas personalizadas passou a depender da RPC de dashboard. Agora essas abas continuam usando apenas o motor de métricas; o resumo de dashboard é consultado para abas com cards fixos. Fontes suplementares indisponíveis são identificadas na planilha.

Ambos os cenários foram reproduzidos por testes que falharam antes da correção e passaram depois. A releitura final não encontrou bloqueio concreto remanescente no diff examinado.

## Spec

A exportação da Visão Geral, o período selecionado, a conversão segundos→minutos e a distinção entre ausência e zero estão cobertos. O Estúdio usa totais da organização, inclusive para membros, conforme seu caráter compartilhado.

A revisão inicial encontrou o primeiro risco acima e uma lacuna de validação da troca de organização. O teste anterior simulava organizações diferentes em hooks que, na implementação real, compartilham o mesmo cache. Ele foi substituído por testes com `useOrgSwitcher`, `useCurrentTeamMember`, `useOrganization`, `useIdentity` e `useCommandMetrics` reais. Membro comum e master virtual alternam de A para B; uma resposta atrasada de A não aparece em B.

Correção da alegação inicial: esta PR preserva o contexto organizacional existente e comprova compatibilidade com a troca; não demonstrou corrigir um defeito separado no seletor de organização.

## Verificações locais

- 350 testes aprovados em 39 arquivos: módulo analytics, períodos, cards, exportação XLSX, isolamento de falhas, seletor real e regressões de propostas/comissões da main.
- O teste do card monta o adaptador real da Visão Geral e verifica número correto e indisponibilidade apenas da resposta.
- O teste de exportação usa ExcelJS real e reabre os arquivos gerados, incluindo uma aba personalizada com falha isolada do dashboard.
- Build de produção, ESLint dos arquivos alterados, dep-cruise ratchet e verificação de whitespace aprovados.
- TypeScript ratchet aprovado: zero erros introduzidos; as 471 ocorrências atuais estão cobertas pelos baselines já existentes.
- Não houve smoke autenticado em navegador nesta máquina. O Docker local está indisponível; não se abriu ambiente Supabase de produção para testes de escrita.

## CI e condição de liberação

A comparação do head inicial do PR (`5401124db`) com a main (`54536f838`) confirmou as mesmas falhas:

| Verificação | Falhas confirmadas no PR | Na main | Evidência |
|---|---:|---:|---|
| Unit Tests | 6 | As mesmas 6 | [PR](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/actions/runs/34978332711/job/104413895327), [main](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/actions/runs/34977869755/job/104412519147) |
| RLS Invariants | 11 | As mesmas 11 | [PR](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/actions/runs/34978332711/job/104411753266), [main](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/actions/runs/34977869755/job/104410162092) |

As falhas unitárias estão em agenda/agendamento; as de banco estão em `oraculo_benchmark_test.sql`. Não foram introduzidas pelo diff de métricas. Baselines e gates foram preservados. E2E ainda não tinha resultado final no momento dessa comparação.

Essa evidência distingue regressão nova de falha anterior; não transforma CI vermelho em aprovação. O PR permanece em rascunho, aguardando conclusão das verificações do novo commit e resolução dos gates antes do merge.
