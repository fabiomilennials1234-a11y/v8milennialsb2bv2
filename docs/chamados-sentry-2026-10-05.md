# Chamados sugeridos — Health check Sentry (2026-10-05)

Org Sentry: `torquecrm` · Projetos: torque-edge, torque-web, torque-qa
Resumo: 0 incidentes de indisponibilidade · 3 erros abertos · 0 resolvidos · sem dados de performance (traces vazios nas últimas 24h).

> Os textos abaixo estão prontos para colar em **Abrir chamado** (Tipo: Defeito). O campo "Detalhes" já está em linguagem simples.

---

## Chamado 1 — Resumos automáticos de conversas não estão sendo gerados  (PRIORIDADE ALTA)

**Assunto:** Resumo automático de conversas falha toda vez que roda
**Tipo:** Defeito · **Impede de trabalhar?** Parcialmente (o CRM funciona, mas os resumos não aparecem)

**O que aconteceu (simples):**
O sistema tem uma rotina que roda sozinha e gera um resumo das conversas de WhatsApp. Essa rotina começa "pegando" uma lista de conversas para resumir. Esse primeiro passo está dando erro, então nenhuma conversa chega a ser resumida. Aconteceu **505 vezes desde 01/10** (144 só nas últimas 23h) e **ainda estava acontecendo 7 minutos antes deste relatório**. Nenhum usuário viu tela de erro, por isso ninguém reclamou — é falha silenciosa.

**Onde está:** função `summarize-conversations-batch`, `supabase/functions/summarize-conversations-batch/index.ts:41-42` (chamada ao banco `claim_conversation_summary_jobs`).
**Sentry:** https://torquecrm.sentry.io/issues/TORQUE-EDGE-1

**Por onde começar (dev jr):**
1. O código esconde o motivo real: troca o erro do banco por uma frase fixa (linha 42). Logue `error.message`/`error.code` antes de lançar.
2. Teste a função `claim_conversation_summary_jobs` no banco de produção — ela existe? mudou de assinatura? deu erro de permissão?
3. Confira se alguma migration recente alterou essa função ou a tabela de jobs de resumo.

---

## Chamado 2 — Falha ao copiar responsáveis na sincronização de clientes  (PRIORIDADE MÉDIA)

**Assunto:** toth-sync-clientes: "Falha ao propagar responsáveis do recorte"
**Tipo:** Defeito · **Impede de trabalhar?** Não

**O que aconteceu (simples):**
Na sincronização de clientes, depois de importar, o sistema tenta copiar quem é o responsável por cada cliente. Essa cópia falhou com "Internal server error" (erro genérico do servidor). Aconteceu **1 vez**, em 04/10 às 19:31 UTC. Pode ter sido uma oscilação, mas se a cópia falha, alguns clientes podem ficar sem responsável.

**Onde está:** `supabase/functions/toth-sync-clientes/index.ts:704`
**Sentry:** https://torquecrm.sentry.io/issues/TORQUE-EDGE-4

**Por onde começar:** veja o que acontece no índice 704 e por que o erro original ("Internal server error") é descartado. Se não voltar a ocorrer em alguns dias, pode ser fechado; antes disso, confira se os clientes dessa sincronização ficaram com responsável.

---

## Chamado 3 — "Sessão inválida ou expirada" ao usar o compartilhamento do Google Agenda  (PRIORIDADE BAIXA)

**Assunto:** Erro de login expirado em /funil/whatsapp (Google Agenda)
**Tipo:** Defeito · **Impede de trabalhar?** Não

**O que aconteceu (simples):**
Ao abrir o Funil WhatsApp, a tela consulta o compartilhamento de agenda do Google. Para 3 usuários (admin), o servidor respondeu que o login deles tinha vencido. Normalmente basta entrar de novo, mas a tela mostra um erro genérico em vez de pedir novo login. Última ocorrência: 04/10 18:15 UTC.

**Onde está:** `src/modules/integrations/hooks/useGoogleCalendarSharing.ts:54-58` (`handleResponse` só repassa a mensagem, sem tratar 401).
**Sentry:** https://torquecrm.sentry.io/issues/TORQUE-WEB-10
Replays: https://torquecrm.sentry.io/explore/replays/521e3d6e88834d48a9c6717847c2d7e4/

**Por onde começar:** tratar resposta 401 renovando a sessão (ou redirecionando para login) em vez de mostrar erro.

---

## Resolvidos desde a última checagem
Nenhum.

## Performance
Sem dados: a consulta de traces (24h) voltou vazia — provavelmente tracing não está habilitado. Vale confirmar.
