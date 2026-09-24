# Notificações e lembretes da agenda — 24/09/2026

## Diagnóstico reproduzido

- `MotorDeSom.destravar()` consultava o estado sem chamar `resume()`: o teste
  exigindo a retomada após o gesto falhou com 0 chamadas em vez de 1.
- `useAvisos` só entregava som/cartão no callback de Realtime. Um novo registro
  recuperado pela consulta periódica atualizava o sino e não alertava o usuário.
- Reunião próxima e follow-up eram excluídos dos cartões. O chat do mesmo lead
  aberto silenciava indevidamente todos os tipos, incluindo agenda.
- A rotina SQL de reunião lia exclusivamente `pipeline_entries`, ignorando
  eventos internos de `meetings`. O teste com criador e participante esperava
  dois destinatários e recebeu nenhum.
- O botão não reproduzia confirmação, descartava rejeições de gravação e o
  indicador de salvamento observava leitura, não a mutação da preferência.

## Evidência de produção (somente leitura)

O projeto `jsjsmuncfkbsbzqzqhfq` tinha `notifications` publicada no Realtime e
os dois crons ativos. A rotina de follow-up executava só às 07h de São Paulo;
a de reunião, a cada 15 minutos. As execuções recentes consultadas tiveram sucesso.

Na janela de sete dias, o banco tinha 5.025 registros de mensagens em 15
organizações, 2.451 de follow-ups atrasados em 21 e 26 de reunião próxima em 4.
Na HGE havia 117 de mensagens, 320 de follow-ups atrasados e 2 de reunião próxima.
Isso prova geração de registros, **não** que navegador/som os entregaram.

A consulta antiga de compromissos de funis atravessava 54.483 entradas e fazia
join com cerca de 65 mil leads: 575ms medidos com EXPLAIN ANALYZE. A nova rotina
usa índice parcial para as 1.085 entradas candidatas e consulta o lead por PK
só depois de verificar a janela de horário. Follow-ups pendentes também ganham
índice parcial. A duração final em produção depende do apply e deverá ser medida.

## Validação sem dados de clientes

- Vitest: áudio, entrega por consulta/Realtime, deduplicação, troca de org e
  destinatário, preferências serializadas/rollback e botão de ativação.
- `node --test tests/integration/agenda-notifications.test.mjs`: executa as
  funções PL/pgSQL reais em PGlite. Cobre reunião sem lead, participantes ativos,
  outra org, convite recusado, follow-up na agenda e na tabela de follow-ups,
  remarcação dentro da hora, leitura sem rearmar, cancelamento, conclusão,
  data legada inválida, projeções duplicadas e grants. Executa também o rollback.
- `node --test tests/integration/notification-audio.browser.test.mjs`: navegador
  Chromium/Edge com autoplay exigindo gesto. Confere contexto inicialmente
  suspenso, clique, lembrete posterior e sinal de áudio não nulo no AnalyserNode.
  `CHROMIUM_PATH` permite indicar um executável já instalado.
- Build de produção e verificações de regressões de tipos/lint/testes.

Resultados finais: 49 testes focados aprovados, ensaio SQL/rollback aprovado e
ensaio de áudio real no Edge aprovado. Build, `typecheck:ratchet` e
`lint:deps:check` aprovados; ESLint dos arquivos alterados sem erros ou warnings.
O `test:ratchet` geral confirmou 33 falhas fora do diff, também reproduzidas no
checkout original `ea7a1be2e`. O `lint:ratchet` original confirmou os cinco
warnings em `quotes/presentation.ts`, `quotes/tool.ts` e testes de cotação;
não pertencem a esta alteração. Baselines de dívida não foram aumentados.
O guarda de versões passou sem duplicações ou colisões com `origin/main`.
Advisors de segurança de produção consultados sem achados relacionados a
notificações; isso não substitui o check dos grants após o futuro apply.

O lint de métricas geral acusa duas âncoras `updated_at` na migration preexistente
`20271021000026_cron_skip_idle_dispatch.sql` (commit `dcf942006`), intocada pelo
diff. O novo SQL não apareceu nos achados. No PR #2176, os checks remotos não
executaram: as anotações de Lint & Build e gitleaks informaram pagamentos
recentes falhos ou limite de gastos do GitHub. Isso é bloqueio da conta, não
resultado de execução dos testes. Nenhuma configuração de cobrança foi alterada.

## Publicação e limites

Não houve aplicação em produção, mensagens de teste para clientes, nem criação
de branch paga do Supabase. O ensaio SQL usa Postgres embarcado e não substitui
a verificação operacional do pg_cron/Realtime hospedado após publicação.
O teste de áudio comprova geração do sinal no navegador, não volume físico dos
alto-falantes do vendedor. Push com o navegador fechado não foi alterado.

Aplicar somente `20271022000000_agenda_notification_reminders.sql`, respeitando
a autorização de produção, e publicar o frontend. Não usar `db push` indiscriminado:
o repositório contém drift de migrations. Rollback correspondente em
`supabase/migrations/rollback/`, preservando o histórico de notificações.

Após apply: verificar os dois jobs a cada minuto, grants negados para
`anon`/`authenticated`, resultados recentes em `cron.job_run_details`, ausência
de duplicação e entrega com usuário de teste autorizado. Som requer interação
na sessão do navegador e segue volume/horário silencioso/preferências pessoais.
