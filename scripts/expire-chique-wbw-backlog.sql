-- ============================================================================
-- Expira o backlog de execuções travadas no nó `wait_business_window` da Chique
-- ----------------------------------------------------------------------------
-- Rode com:  psql "$DATABASE_URL" -f scripts/expire-chique-wbw-backlog.sql
--
-- ⚠️ PROD NÃO TEM PITR. Este arquivo é desenhado para abortar sozinho se o
--    mundo não estiver como foi medido — não confie em ninguém ler comentário
--    antes de commitar.
--
-- ############################################################################
-- # O QUE ESTE SCRIPT DESTRÓI — leia ANTES de rodar
-- ############################################################################
--
-- Cancela 101 execuções da org Chique, em dois grupos com naturezas DIFERENTES:
--
--   77 `processing` no nó 6f45580c — zumbis de verdade. Nunca vão sair sozinhas:
--        o executor antigo retornava `success:false` sem escrever linha terminal
--        e o worker também não escrevia. Cancelar é a única saída.
--
--   22 `running` no nó 6f45580c  ┐  NÃO são zumbis. Sob o código NOVO elas
--    2 `running` no nó 6ab311ff  ┘  estariam a menos de 24h de atraso, seriam
--        retomadas e **enviariam legitimamente**. Este script as mata.
--
-- Ou seja: 24 das 101 são trabalho que o código corrigido entregaria. Cancelá-las
-- é decisão do CTO (2026-08-19), não consequência técnica — a Chique tomou um 463
-- ("temporary restriction for starting new conversations") em 13/08, e soltar um
-- backlog represado de dias em cima de um número já penalizado é o risco que se
-- escolheu não correr. Se essa decisão mudar, o recorte a mexer é o predicado de
-- `status`: tirar `'running'` da lista preserva as 24 e ainda limpa os 77 zumbis.
--
-- NÃO são tocadas: as 8 execuções da "P. mercos" (`next_run_at IS NULL`), que não
-- estão paradas neste nó — o predicado (4) as exclui mecanicamente.
--
-- ############################################################################
--
-- Contexto do bug (medido em prod 2026-08-19 17:24 UTC / 14:24 BRT):
--
--   O nó gravava `action: "hold_until:"` (alvo VAZIO). O executor fazia
--   `action.split(":")[1]` → `""` → `computeNextWindowStart(windows, "")` →
--   null → `return { success:false }` SEM escrever linha terminal. O worker
--   também não escrevia no ramo `else`. A linha ficava `processing` para sempre.
--
--   Com `per_org_cap = 5`, os 77 zumbis consumiam as 5 vagas por ciclo e
--   mataram de fome a org inteira — o workflow "R. mercos", configurado
--   corretamente, ficou parado desde as 11:00.
--
-- Este arquivo NÃO é migration, por desenho: a guarda F4 do projeto mantém dado
-- de cliente fora do `apply` de migration, para que um `db push` com URL errada
-- vire erro de schema recuperável e não mudança de dado.
--
-- ORDEM: rode ANTES do deploy da correção do executor.
-- ============================================================================

-- Qualquer erro aborta o script inteiro e desfaz a transação aberta.
-- Sem isto, `psql -f` seguiria para o próximo comando e commitaria mesmo depois
-- de uma falha.
\set ON_ERROR_STOP on


-- ────────────────────────────────────────────────────────────────────────────
-- BLOCO 1 — conferência. SOMENTE LEITURA, fora de transação.
-- Deve devolver SÓ a Chique e SÓ os 2 nós listados.
-- ────────────────────────────────────────────────────────────────────────────
SELECT we.organization_id, w.name AS workflow, we.current_node_id, we.status,
       count(*) AS execucoes, min(we.started_at) AS mais_antiga,
       max(we.next_run_at) AS ultimo_agendamento
FROM public.workflow_executions we
JOIN public.workflows w ON w.id = we.workflow_id
WHERE we.organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8'
  AND we.current_node_id IN ('6f45580c-c058-46c5-a199-7245c3dd4c59',
                             '6ab311ff-d36a-49a8-a539-449de71dce4d')
  AND we.status IN ('processing','running','waiting_response')
GROUP BY 1,2,3,4 ORDER BY 3,4;

-- Esperado (baseline de 2026-08-19 17:24 UTC):
--   6f45580c-c058-46c5-a199-7245c3dd4c59  → 77 processing + 22 running
--   6ab311ff-d36a-49a8-a539-449de71dce4d  →  2 running
--
-- O BLOCO 2 não depende de você conferir isto: ele aborta sozinho se o total
-- afetado divergir. A leitura serve para você VER o que mudou, se abortar.


-- ────────────────────────────────────────────────────────────────────────────
-- BLOCO 2 — o UPDATE, com rollback MECÂNICO.
-- ────────────────────────────────────────────────────────────────────────────
BEGIN;

-- Por que cada estreitamento do WHERE existe:
--
-- (1) organization_id — a tabela cruza ~30 orgs. Sem este predicado o UPDATE é
--     um incidente multi-tenant, não uma limpeza. É o primeiro filtro por isso.
--
-- (2) current_node_id IN (...) — restringe aos DOIS nós de janela auditados.
--     Outros nós da mesma org podem ter execuções legitimamente em voo.
--
-- (3) status IN ('processing','running','waiting_response') — nunca toca linha
--     já terminal. Reexecutar é idempotente: as linhas canceladas saem do
--     conjunto (e aí o total afetado vira 0, e a guarda abaixo aborta —
--     que é o comportamento correto para uma segunda execução acidental).
--     É AQUI que as 24 `running` entram; ver o cabeçalho.
--
-- (4) next_run_at IS NOT NULL AND next_run_at < now() - INTERVAL '1 hour' —
--     carga ESTRUTURAL, não cosmética:
--       (a) fecha a corrida entre o BLOCO 1 e este UPDATE. Um lead que entrou no
--           funil agora tem execução recém-agendada para o FUTURO; sem esta
--           cláusula ela seria cancelada junto — e essa, sim, é destruição de
--           trabalho que ninguém decidiu destruir.
--       (b) exclui mecanicamente as 8 da "P. mercos" (`next_run_at IS NULL`),
--           que não estão paradas neste nó.
--     A janela de 1 hora é folga: todo agendamento do backlog está vencido desde
--     2026-08-19 11:00, muito além dela.
--
-- UPDATE e guardas no MESMO bloco plpgsql, de propósito: `GET DIAGNOSTICS` lê a
-- contagem afetada sem passar por variável de psql. (`\gset` + `:var` não serve
-- aqui — psql não interpola variável dentro de string dollar-quoted, então a
-- guarda falharia em silêncio ou nem compilaria.)
--
-- Qualquer `RAISE EXCEPTION` abaixo desfaz o UPDATE junto, porque tudo está na
-- mesma transação, e `ON_ERROR_STOP` impede o script de seguir até o `COMMIT`.
-- O rollback é mecânico: não depende de ninguém ler a contagem e decidir.
DO $$
DECLARE
  esperado  CONSTANT int := 101;   -- 77 processing + 22 running + 2 running
  afetadas  int;
  restantes int;
BEGIN
  UPDATE public.workflow_executions
  SET status       = 'cancelled',
      error        = 'expired:backlog_wait_business_window_20260819',
      completed_at = now(),
      next_run_at  = NULL,
      updated_at   = now()
  WHERE organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8'
    AND current_node_id IN ('6f45580c-c058-46c5-a199-7245c3dd4c59',
                            '6ab311ff-d36a-49a8-a539-449de71dce4d')
    AND status IN ('processing','running','waiting_response')
    AND next_run_at IS NOT NULL
    AND next_run_at < now() - INTERVAL '1 hour';

  GET DIAGNOSTICS afetadas = ROW_COUNT;

  IF afetadas <> esperado THEN
    RAISE EXCEPTION
      'ABORTADO: esperava cancelar % execucoes, o UPDATE afetou %. '
      'O mundo mudou desde a medicao de 2026-08-19 17:24 UTC. '
      'Rode o BLOCO 1, entenda a diferenca e recalibre `esperado` antes de tentar de novo.',
      esperado, afetadas;
  END IF;

  -- Nenhuma linha pode sobrar em `processing` nestes dois nós.
  SELECT count(*) INTO restantes
  FROM public.workflow_executions
  WHERE organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8'
    AND current_node_id IN ('6f45580c-c058-46c5-a199-7245c3dd4c59',
                            '6ab311ff-d36a-49a8-a539-449de71dce4d')
    AND status = 'processing';

  IF restantes <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: ainda restam % execucoes em processing.', restantes;
  END IF;

  RAISE NOTICE 'OK: % execucoes canceladas, 0 restantes em processing.', afetadas;
END $$;

-- Retrato do resultado (aparece no output antes do COMMIT).
SELECT status, count(*) FROM public.workflow_executions
WHERE organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8'
  AND current_node_id IN ('6f45580c-c058-46c5-a199-7245c3dd4c59',
                          '6ab311ff-d36a-49a8-a539-449de71dce4d')
GROUP BY 1;

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- Por que `cancelled` e não um status novo `expired`
-- ----------------------------------------------------------------------------
-- `workflow_executions.status` é TEXT LIVRE, sem check constraint — nada obriga
-- um leitor a aprender um valor novo. E `STATUS_CONFIG` em
-- src/modules/workflows/pages/AutomacoesExecucoes.tsx faz
-- `STATUS_CONFIG[status] || STATUS_CONFIG.running`: um status desconhecido
-- renderiza "Executando" com spinner — um terminal exibido como eterno, que é
-- exatamente o sintoma que este script existe para apagar.
--
-- `cancelled` já tem badge e stat card na tela. O motivo específico vai no
-- prefixo de `error` (`expired:*`), que é texto e não precisa que ninguém
-- aprenda nada.
-- ────────────────────────────────────────────────────────────────────────────
