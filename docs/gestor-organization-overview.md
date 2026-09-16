# Área do gestor — organizações e indicadores

Rota: `/gestor`. Mantém a identidade `gestores` e a lista de vínculos
`gestor_organizations`; não altera permissões master nem as permissões
operacionais já existentes nas organizações vinculadas.

## Comportamento

- Lista todas as organizações vinculadas ao gestor ativo, inclusive sem movimento.
- Leads: registros criados nas últimas 168 horas, excluindo lixeira e sombras.
- Vendas: eventos `sale` por `sold_at` nas últimas 168 horas, sem vendas estornadas.
- Online: membros ativos da organização com `user_presence.last_seen_at` nos
  últimos 2 minutos. Usa a presença já renovada a cada minuto pelas notificações
  enquanto a aba fica visível. Deduplica usuários e permite ver seus nomes.
- Atualiza ao abrir, recuperar foco e a cada minuto; também oferece atualização manual.
- Busca por nome/slug. Revalida o vínculo antes de entrar no app da organização.
- Erros não aparecem como zeros ou ausência de vínculos e ocultam dados antigos.
- Organizações bloqueadas permanecem na lista, mas sem indicadores ou presença
  e sem permitir entrada. Usa o predicado existente `org_access_blocked`,
  inclusive suas liberações administrativas. Os totais explicam essa exclusão.
- Gestores aparecem com o cargo “Gestor” no perfil e no menu pessoal; o papel
  efetivo continua `admin` nos vínculos administrativos. A identidade existente
  `gestores` dá acesso adicional ao hub, sem criar valor novo no enum `app_role`.
- O menu pessoal dentro das organizações oferece “Área do Gestor”.
- Gestores não veem suporte no hub, botão flutuante, anúncios, painel global,
  paleta de comandos ou ações de atendimento em Assinatura. Falha na consulta
  de identidade mantém esses componentes ocultos. Os dados administrativos da
  assinatura continuam disponíveis conforme a permissão já existente.

## Isolamento

`public.gestor_organization_overview()` não aceita parâmetros de usuário ou org.
É uma fachada `SECURITY INVOKER` para a implementação privada, que confere
`auth.uid()`, gestor ativo e seus vínculos em cada chamada. `anon` não executa
nenhuma das duas funções. A implementação privilegiada fica no schema `private`,
com `search_path` vazio e nomes de tabelas qualificados.

Não há dependência de RPCs, páginas ou layouts master. A leitura de presença
continua restrita ao próprio usuário fora do resumo. Gestor sem vínculos recebe
lista vazia; gestor inativo, membro comum e master sem identidade gestor recebem
acesso negado. A revogação de vínculo é efetiva na próxima consulta.

## Validação local — 2026-09-16

- 20 testes de SQL executados em PostgreSQL embarcado (PGlite), com papéis reais,
  limites de período, estornos, presença, isolamento e revogação. Incluem o gate
  da RPC master original, bloqueios de assinatura/override e rollback/reaplicação.
  Comando: `node --test tests/integration/gestor-organization-overview.test.mjs`.
- 51 testes Vitest: página, consulta, identidade, guard de gestor, cargo/admin,
  suporte e assinatura.
- Build, ESLint dos arquivos alterados, `git diff --check`, lint de métricas e
  ratchet de TypeScript aprovados (nenhum erro de tipo introduzido).
- Renderização Playwright em desktop e celular com dados fictícios; busca,
  expansão de usuários e ausência de overflow horizontal da página conferidas.
- O guard geral `guard:master-ghost` tem 25 ocorrências fora do baseline e 42
  entradas antigas na base. O scanner retorna resultados idênticos com e sem
  esta migration. Essa dívida não foi alterada.

## Cadastros atualizados — 2026-09-16

A pedido do usuário, a lista identificada no manifesto de 2026-09-11 foi
atualizada no banco existente: Augusto, Fábio, Guilherme, Gustavo, João, Kauã
e Maycon. Os sete têm identidade gestor ativa e nenhum tem master ativo.

- João recebeu a identidade gestor e os seis vínculos de suas equipes ativas.
  Seus seis cargos passaram a Gestor; Liris passou de member a admin, conforme
  a solicitação de acesso administrativo. Os outros cinco já eram admin.
- O cargo de Maycon em seu vínculo de equipe ativo passou de Agency a Gestor,
  mantendo admin. Seus 110 vínculos de portfólio foram preservados.
- Os outros cargos ativos já eram Gestor/admin. Augusto segue sem organização.
- Os 144 vínculos de portfólio anteriores, os cinco vínculos de equipe inativos
  e os registros master inativos foram preservados. Não foram criados seats,
  alteradas senhas ou removidos bloqueios de acesso das organizações.
- Verificação após a transação: sete gestores ativos, onze vínculos de equipe
  ativos com admin/Gestor e seis vínculos de portfólio adicionais. Consultas
  sob `authenticated` confirmaram o portfólio, ausência de master e o conjunto
  de orgs admin operacional, respeitando `org_access_blocked` já existente.

Snapshots, SQL aplicado, verificação e rollback manual estão nos artefatos
locais `outputs/gestor-lista` do workspace principal, fora do código versionado.

A consulta de indicadores foi aplicada em produção em 16/09/2026, após autorização
explícita para aplicação e merge. Verificação sob `authenticated` para os sete
logins confirmou vínculos exatos, ausência de Master, mascaramento dos dados de
organizações bloqueadas e negação para não-gestor/anon. Não houve alteração das
políticas ou funções de autorização existentes.

## Publicação

Migration: `20260916181815_gestor_organization_overview.sql`, aplicada antes do frontend.
Depende das tabelas existentes `gestores`, `gestor_organizations`, `leads`,
`sale_events`, `team_members` e `user_presence`. A migration não muda esses dados.
Produção segue a autorização explícita e revisão exigidas em `AGENTS.md`.
O ledger remoto registrou `20260916191447` com nome `gestor_organization_overview`
(timestamp do apply via MCP). É a mesma migration: não reaplicar por divergência
do prefixo local. Tipos foram regenerados e guardados nos artefatos da publicação;
a ponte local evita trazer o drift inteiro do schema para esta alteração.

PR: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/2127.
Jira: SCRUM-740, subtarefas SCRUM-842 a SCRUM-850.

Rollback: restaurar o frontend anterior e, então, remover primeiro
`public.gestor_organization_overview()` e depois
`private.gestor_organization_overview()`. Preservar o schema privado e todas as
tabelas compartilhadas. Script testado: `supabase/ops/rollback-gestor-organization-overview.sql`.
