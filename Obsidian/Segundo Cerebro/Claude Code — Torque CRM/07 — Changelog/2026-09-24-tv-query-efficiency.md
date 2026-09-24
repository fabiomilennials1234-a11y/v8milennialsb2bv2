---
type: changelog
title: TV — consulta financeira independente da composição local
status: active
created: 2026-09-24
updated: 2026-09-24
tags: [analytics, tv, performance, supabase]
owner: gabriel
---

# TV — menos consultas repetidas

`useTVDashboardData` separa a consulta `get_sales_metrics` dos cálculos de metas,
listas e reuniões. Antes, arrays completos faziam parte da chave: qualquer
alteração gerava outra consulta financeira. Agora a chave inclui usuário,
organização, período, data e filtro do membro; a composição reage localmente.

Removido timer duplicado da página. Hook mantém polling de 30 segundos visível,
com compartilhamento entre página e Coach. Refresh manual mantém retorno de
métricas compostas e respeita identidade/organização prontas. Troca de tenant
não mostra cache da organização anterior. Erros reais continuam propagando;
somente RPC ausente usa fallback de zeros.

Rotação visual de 12 segundos, cálculo de receita líquida, filtros do membro e
consulta de reuniões não mudaram. Atualização de lista/meta é imediata; receita
reflete próxima consulta de 30 segundos ou refresh manual, sem promessa de
sincronização financeira instantânea a cada mudança de pipe.

Teste com dois observadores e remontagens a cada 12 segundos: três consultas em
60 segundos (inicial, 30 e 60). Alterações em metas/listas/distribuição de SDRs
recompõem dados sem nova RPC. Testes adicionais cobrem organização, usuário,
permissão, virada de mês, background, erros e RPC ausente.

Redução é de consultas ao Postgres; esta etapa não representa economia direta
de invocações Edge nem comprova a meta mensal de 1,4M.

Arquivos: `src/modules/analytics/hooks/useTVDashboardData.ts`,
`src/modules/analytics/pages/TVDashboard.tsx` e teste adjacente do hook.

## Validação

- 26 testes existentes passaram antes da alteração; 21 testes direcionados
  passaram depois, incluindo os sete novos casos de comportamento.
- Build de produção passou.
- Verificação de tipos: zero erros introduzidos. Revisão independente aprovada,
  com repetição dos 21 testes direcionados.
- Suíte global: 13.576 passaram, 151 falharam, 154 ignorados; sete erros de
  coleta separados. Zero assinaturas de falha novas frente à execução da etapa
  anterior; não apresentar a suíte global como verde.
- Lint global repete os cinco avisos preexistentes de quotes já registrados;
  nenhum baseline foi alterado para esconder dívida.
