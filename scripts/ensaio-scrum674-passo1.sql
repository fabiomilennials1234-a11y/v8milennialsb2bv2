-- ANTES — ensaio do passo 1 da SCRUM-674 contra PRODUÇÃO.
-- Abre a transação e prova o estado de partida. Nunca rodar sozinho: o .sh
-- monta este + a migration + o `-depois`, que aborta.

BEGIN;

DO $$
DECLARE
  v_existentes text;
  v_escritoras int;
BEGIN
  -- Controle de partida: as 4 funções NÃO podem existir ainda. Se existirem, o
  -- ensaio mediria o que já estava lá e passaria verde por engano.
  SELECT string_agg(p.proname, ', ') INTO v_existentes
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('fn_entrada_sistema_criar','fn_entrada_sistema_atualizar',
                       'fn_entrada_custom_criar','fn_entrada_custom_atualizar');
  IF v_existentes IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: as funções já existem em prod (%). Este é o passo 1; se já foram criadas, o ensaio não mede nada.', v_existentes;
  END IF;

  -- Retrato do problema que o card ataca, para o relatório da janela.
  SELECT count(DISTINCT p.oid) INTO v_escritoras
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?(pipe_whatsapp|pipe_confirmacao|pipe_propostas|custom_pipelines|custom_pipeline_stages|custom_pipe_entries)\M';
  RAISE NOTICE 'ANTES: % funcoes SQL escrevem pelos espelhos (esperado 5)', v_escritoras;
  IF v_escritoras <> 5 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: esperava 5 escritoras pelos espelhos, achei %. O mundo mudou desde a medição — remeça antes de aplicar.', v_escritoras;
  END IF;
END $$;
