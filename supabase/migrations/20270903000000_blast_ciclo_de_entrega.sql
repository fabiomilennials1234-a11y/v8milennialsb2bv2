-- ============================================================================
-- #1724 — ciclo de entrega: o callback fecha a linha e o custo vira realizado
--
-- O QUE ESTA MIGRATION TRAZ
--   1. O índice parcial que serve a varredura.
--   2. `encerrar_entregas_vencidas()` — a varredura do prazo de entrega.
--   3. O job de cron, VERSIONADO. Job fora do ledger é como o buraco entre os 53
--      de produção e os do repo se abriu.
--
-- O QUE ELA NÃO TRAZ, E POR QUÊ
--   O resumo do Disparo (contagens + custo previsto e realizado) foi planejado
--   como RPC e NÃO entrou. O frontend deploya sozinho no merge para a main; a
--   migration é botão do humano. Entre um e outro a RPC não existiria, e o
--   painel mostraria "0 enviados" — que é exatamente a mentira que este ticket
--   recusa para o custo. A agregação vive no cliente, paginada, somada em
--   inteiros de 10^-4 (`src/modules/campaigns/lib/blast-delivery-summary.ts`).
--   Uma função que ninguém chama seria andaime, e o CLAUDE.md manda não deixar.
--
-- POR QUE A VARREDURA EXISTE
--   O TTL do template da Meta vai a 30 dias, e a mensagem não entregue dentro
--   dele é descartada EM SILÊNCIO — não há callback de expiração (ADR-0029). Sem
--   alguém varrendo, a linha de quem nunca recebeu fica `sent` para sempre, e
--   `sent` quer dizer "aceito pela fila", não "entregue". O estado terminal é
--   `unconfirmed`: nem entrega, nem falha — ausência de informação (#1721).
--
-- POR QUE NÃO HÁ EDGE FUNCTION AQUI
--   A varredura é um UPDATE. Uma edge function significaria net.http_post +
--   boundary + CORS + segredo + deploy do humano para rodar um comando que o
--   Postgres já sabe rodar, e um caminho a mais para falhar em silêncio. O cron
--   chama SQL direto.
--
-- ⚠️ EXCEÇÃO NOMEADA à regra "SECURITY DEFINER valida role/org dentro"
--   (`supabase/migrations/CLAUDE.md` § Gotchas).
--
--   `encerrar_entregas_vencidas()` NÃO valida org por dentro, e não é esquecimento.
--   Ela é uma varredura GLOBAL por desenho — o prazo de entrega vence igual em
--   toda organização — e **não recebe parâmetro nenhum**: não há entrada de
--   usuário, logo não há IDOR possível. Validar "a org do chamador" não faria
--   sentido num job de cron, que não tem chamador.
--
--   A defesa é o grant, e por isso ela é verificada e não presumida:
--   `scripts/verificar-grants-1724.sql` prova `anon=false, authenticated=false,
--   service_role=true` CONTRA O ALVO DO APPLY. Esse item fecha lá, não aqui — o
--   grant é concedido pelo banco no `CREATE`, não por este SQL. Mesmo desenho de
--   `claim_blast_recipients` (#1722), que também varre todos os tenants.
--
-- SÓ SCHEMA NO APPLY (guarda F4 do CLAUDE.md). O único UPDATE está DENTRO do
-- corpo de uma função, não no apply — mesmo caso de `claim_blast_recipients`
-- (#1722), que é o falso positivo que o runbook prevê para varredura por linha.
--
-- ⚠️ ESTA MIGRATION INVALIDA O ROLLBACK DO #1721.
--   `rollback/20270823000000_...sql:8-11` já avisava: ele devolve o CHECK a
--   quatro valores e para de ser seguro no momento em que alguma fatia escrever
--   `delivered`/`unconfirmed`. Esta é a fatia. O rollback DESTA migration desfaz
--   o estado antes, e tem de rodar PRIMEIRO.
-- ============================================================================

-- ─── 1. O índice que serve a varredura ──────────────────────────────────────
-- Parcial em `status = 'sent'`: é o único estado que a varredura olha, e ele é
-- transitório por desenho. NÃO concorrente, pelo mesmo motivo medido no #1721 —
-- a tabela inteira de produção tem 235 linhas e o lock é de milissegundos.

CREATE INDEX IF NOT EXISTS idx_blast_plan_recipients_entrega_vencida
  ON public.blast_plan_recipients (sent_at)
  WHERE status = 'sent';

COMMENT ON INDEX public.idx_blast_plan_recipients_entrega_vencida IS
  'Serve encerrar_entregas_vencidas() (#1724): as linhas que saíram e ainda '
  'esperam confirmação do canal.';

-- ─── 2. A varredura do prazo de entrega ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.encerrar_entregas_vencidas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- O TTL máximo do template da Meta (ADR-0029). Constante nomeada, e NÃO coluna
  -- de configuração: não existe tela que a preencheria, e config sem produtor é
  -- gate sem produtor — o defeito que o próprio ADR-0029 registra sobre
  -- `consent_records`. Encurtar isto encerra como "não confirmada" uma linha que
  -- ainda podia receber callback: mexer só com medição.
  c_prazo_de_entrega CONSTANT interval := interval '30 days';
  v_encerradas integer;
BEGIN
  IF to_regclass('public.blast_plan_recipients') IS NULL THEN
    RETURN 0;
  END IF;

  WITH vencidas AS (
    UPDATE public.blast_plan_recipients r
       SET status = 'unconfirmed'
      FROM public.blast_plans p
     WHERE p.id = r.plan_id
       AND r.status  = 'sent'
       -- DUAS condições para o mesmo fato — que a mensagem saiu pelo Canal
       -- Oficial e, portanto, que um callback de entrega era esperado:
       --
       --   · `sent_at IS NOT NULL` — hoje SÓ o worker oficial escreve essa
       --     coluna (`blast-official-runner.ts:265`); o caminho do Chip grava
       --     apenas {status, reason} (`blast-plan-store.ts:71`,
       --     `mass-send-status/index.ts:89`).
       --   · `p.template IS NOT NULL` — o discriminador de regime do #1722, o
       --     mesmo que `claim_blast_recipients` usa.
       --
       -- A primeira sozinha bastaria HOJE. A segunda é o que impede a #1731 de
       -- transformar esta varredura num encerrador de linhas do Chip no dia em
       -- que ela der marca de tempo ao Chip — e o Chip não tem callback de
       -- entrega, então `unconfirmed` ali significaria outra coisa.
       AND r.sent_at IS NOT NULL
       AND p.template IS NOT NULL
       AND r.sent_at < now() - c_prazo_de_entrega
    RETURNING 1
  )
  SELECT count(*) INTO v_encerradas FROM vencidas;

  RETURN v_encerradas;
END;
$$;

COMMENT ON FUNCTION public.encerrar_entregas_vencidas() IS
  'Encerra como `unconfirmed` as linhas do Disparo Oficial que saíram e nunca '
  'tiveram confirmação dentro do TTL de 30 dias da Meta (#1724). A Meta descarta '
  'em silêncio: não existe callback de expiração, então sem esta varredura a '
  'linha ficaria `sent` para sempre.';

-- `CREATE OR REPLACE` RESSUSCITA o EXECUTE de PUBLIC: o grant é do banco no
-- momento do CREATE, não do SQL acima. Revogar dos três é obrigatório, e nenhum
-- sozinho basta.
REVOKE ALL     ON FUNCTION public.encerrar_entregas_vencidas() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encerrar_entregas_vencidas() FROM anon;
REVOKE EXECUTE ON FUNCTION public.encerrar_entregas_vencidas() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.encerrar_entregas_vencidas() TO service_role;

-- ─── 3. O cron, versionado ──────────────────────────────────────────────────
-- Diário, e não por minuto: o prazo é de 30 dias. Um tique por dia atrasa o
-- encerramento em no máximo 24 horas sobre um prazo de 720, e poupa 1.439
-- varreduras que não achariam nada.
--
-- 04:17 UTC — fora do horário comercial brasileiro e fora dos minutos redondos
-- onde os outros jobs se acumulam.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('encerrar-entregas-vencidas')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encerrar-entregas-vencidas');

    PERFORM cron.schedule(
      'encerrar-entregas-vencidas', '17 4 * * *',
      $cron$SELECT public.encerrar_entregas_vencidas();$cron$
    );
  END IF;
END $$;
