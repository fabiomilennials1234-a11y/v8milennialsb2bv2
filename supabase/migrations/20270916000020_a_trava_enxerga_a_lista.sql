-- A trava de valor no negócio passa a ser SECURITY DEFINER.
--
-- Conserta um furo da 20270916000010, achado ao verificá-la em prod DEPOIS de
-- aplicada — e que o ensaio transacional não podia ter pego.
--
-- ── O furo ───────────────────────────────────────────────────────────────
-- `fn_exige_valor_no_negocio` decide se uma org está poupada consultando
-- `rollout_exige_valor_venda`. Essa tabela tem RLS com uma única policy:
--
--   rollout_exige_valor_master · SELECT · authenticated · USING is_master_user()
--
-- Ou seja: só master enxerga. A função foi escrita sem SECURITY DEFINER, então
-- sob uma sessão comum ela roda como `authenticated`, o EXISTS não acha
-- linha nenhuma, e ela conclui que NINGUÉM está poupado.
--
-- Medido em prod, na mesma transação, trocando só o papel:
--   como superuser:     19 orgs poupadas visíveis
--   como authenticated:  0 orgs poupadas visíveis
--
-- O efeito seria recusar a venda justamente nas 19 orgs que foram
-- deliberadamente isentadas — as que mais dependem de não serem travadas.
--
-- A recuperação do valor tem o mesmo problema por outro caminho:
-- `pipeline_entries` também tem RLS, e uma sessão que não enxergasse a entrada
-- deixaria de recuperar o valor que existe, e recusaria quem informou.
--
-- ── Por que o ensaio não pegou ───────────────────────────────────────────
-- Ensaio transacional roda pela Management API, como superuser. Superuser
-- bypassa RLS. Sete caminhos passaram verdes por um motivo que não vale para
-- o usuário real.
--
-- Régua com o defeito da peça. O ensaio segue valendo para o que ele mede —
-- lógica, ordem de trigger, receita que não se move —, mas não substitui
-- verificar sob o papel de quem usa.
--
-- ── Por que está latente, e mesmo assim conserto agora ───────────────────
-- Hoje ninguém escreve `deals.outcome` de sessão comum. Os três escritores
-- rodam em contexto que bypassa RLS:
--   · `definir_desfecho_da_entrada`  SECURITY DEFINER  (único caminho do front)
--   · `fn_capture_sale_event`        SECURITY DEFINER
--   · automação de workflow          service_role
--
-- Então nada está quebrado neste minuto. Mas a correção da trava passa a
-- depender de uma promessa que não está escrita em lugar nenhum: "nunca
-- escreva outcome direto". O B2c e o B2d mexem exatamente nesses caminhos.
-- Deixar a mina armada para a próxima fatia é escolher que ela exploda longe
-- de quem a plantou.
--
-- ── DEFINER aqui não abre vetor ──────────────────────────────────────────
-- O padrão perigoso é RPC DEFINER que aceita org por parâmetro: o chamador
-- escolhe o tenant e a função obedece.
--
-- Não é o caso. Isto é função de TRIGGER — não é chamável por ninguém, não tem
-- parâmetro, e a org vem de `NEW.organization_id`, a linha que já está sendo
-- escrita sob as policies de `deals`. Ela também não devolve dado: ou levanta
-- exceção, ou copia para `NEW.value` um número que pertence ao mesmo negócio.
--
-- `fn_capture_sale_event`, que faz a mesma leitura no vizinho, já é DEFINER
-- pelo mesmo motivo.
--
-- Reaplicar é no-op.

CREATE OR REPLACE FUNCTION public.fn_exige_valor_no_negocio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recuperado numeric;
BEGIN
  -- Só na transição PARA ganho. Verificar na permanência travaria a edição de
  -- um negócio já ganho.
  IF NEW.outcome IS DISTINCT FROM 'won' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome IS NOT DISTINCT FROM NEW.outcome THEN
    RETURN NEW;
  END IF;

  -- ── Recuperar antes de recusar ──────────────────────────────────────────
  -- Roda MESMO em org poupada: quem foi poupado da exigência não foi poupado
  -- de ter o número certo.
  IF NEW.value IS NULL THEN
    BEGIN
      SELECT NULLIF(btrim(pe.metadata->>'sale_value'), '')::numeric
        INTO v_recuperado
        FROM public.pipeline_entries pe
       WHERE pe.deal_id = NEW.id
         AND NULLIF(btrim(COALESCE(pe.metadata->>'sale_value', '')), '') IS NOT NULL
       ORDER BY pe.closed_at DESC NULLS LAST, pe.entered_at DESC
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      -- Metadata é campo livre: já houve texto onde devia haver número.
      -- Texto ilegível vale o mesmo que ausência — cai na recusa abaixo.
      v_recuperado := NULL;
    END;

    IF v_recuperado IS NOT NULL THEN
      NEW.value := v_recuperado;
    END IF;
  END IF;

  IF NEW.value IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Org poupada do rollout segue passando sem valor.
  IF EXISTS (
    SELECT 1 FROM public.rollout_exige_valor_venda r
     WHERE r.organization_id = NEW.organization_id
       AND r.religado_em IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- Zero é resposta válida — venda de cortesia, troca, ajuste. AUSÊNCIA não é:
  -- "não informei" e "informei zero" são coisas diferentes que hoje viram o
  -- mesmo NULL na conta do ticket médio.
  RAISE EXCEPTION
    'Informe o valor antes de marcar o negócio como ganho.'
    USING ERRCODE = 'check_violation',
          HINT = 'Abra o negócio e preencha o valor, ou adicione os produtos vendidos. Se foi sem cobrança, informe 0.';
END;
$function$;

COMMENT ON FUNCTION public.fn_exige_valor_no_negocio() IS
  'Recusa marcar um negócio como ganho sem valor, e antes disso recupera o valor da entrada do funil quando ele só existe lá. SECURITY DEFINER porque precisa enxergar rollout_exige_valor_venda (RLS: só master) e pipeline_entries para decidir — sem isso recusaria as 19 orgs poupadas. Vale para os três caminhos (botão, arrastar, automação) porque mora no choke: o UPDATE de deals.outcome.';

-- DROP+CREATE reseta grants para PUBLIC. Aqui foi CREATE OR REPLACE, que os
-- preserva — mas função de trigger não é chamável, então não há EXECUTE a
-- revogar. Registrado para quem vier converter isto em DROP.

-- ── Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_definer boolean; v_dono text;
  v_org uuid; v_user uuid; v_lead uuid; v_d uuid; v_linhas integer := -1;
BEGIN
  SELECT p.prosecdef, pg_get_userbyid(p.proowner) INTO v_definer, v_dono
    FROM pg_proc p WHERE p.proname = 'fn_exige_valor_no_negocio';
  IF NOT COALESCE(v_definer, false) THEN
    RAISE EXCEPTION 'fn_exige_valor_no_negocio nao ficou SECURITY DEFINER';
  END IF;
  -- DEFINER só bypassa RLS se o dono for dono das tabelas lidas.
  IF v_dono <> 'postgres' THEN
    RAISE EXCEPTION 'dono inesperado (%): DEFINER nao enxergaria as tabelas', v_dono;
  END IF;

  -- ── A prova que faltou na 20270916000010 ────────────────────────────────
  -- Uma org POUPADA tem de conseguir fechar sem valor sob o papel de quem usa
  -- o produto, não sob o superuser da Management API.
  --
  -- 🚨 A primeira versão desta guarda fazia `SET LOCAL ROLE authenticated` e
  -- mandava o UPDATE. Ela passou — inclusive contra a função CEGA, que é o que
  -- ela existe para pegar. Motivo: sem claims de JWT, `get_my_organization_ids()`
  -- volta vazio, a policy `deals_update` recusa a linha, e o UPDATE afeta ZERO
  -- linhas. O trigger nunca dispara e o silêncio conta como aprovação.
  --
  -- Por isso: claims de um usuário real da org, e ROW_COUNT conferido. Teste
  -- que não consegue rodar tem de falhar, não passar.
  SELECT tm.organization_id, tm.user_id INTO v_org, v_user
    FROM public.team_members tm
    JOIN public.rollout_exige_valor_venda x
      ON x.organization_id = tm.organization_id AND x.religado_em IS NULL
   WHERE tm.user_id IS NOT NULL AND tm.is_active
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id = tm.organization_id)
   LIMIT 1;
  -- ⚠️ Banco VAZIO não é guarda barrada.
  --
  -- Esta sonda precisa de uma org real, com membro ativo e na lista de
  -- poupadas. Em produção isso existe; num banco recém-criado (`db reset`, CI,
  -- ambiente novo) não existe nada, e abortar ali travaria toda criação de
  -- ambiente por uma verificação que não tinha o que verificar.
  --
  -- A distinção que importa: "não há fixture" é motivo para PULAR; "há fixture
  -- e a sonda não conseguiu rodar" é motivo para FALHAR — é o caso do
  -- ROW_COUNT lá embaixo.
  IF v_org IS NULL THEN
    RAISE NOTICE 'sem org poupada com usuario ativo — sonda de RLS pulada (banco novo?)';
    RETURN;
  END IF;

  SELECT l.id INTO v_lead FROM public.leads l WHERE l.organization_id = v_org LIMIT 1;

  -- ⚠️ A sonda escreve: cria um negócio e, ao fechá-lo, um evento no caderno.
  -- Nada disso pode sobrar em prod — e apagar depois é IMPOSSÍVEL: o DELETE do
  -- negócio tenta anular `sale_events.deal_id`, e `sale_events` é append-only
  -- (ADR-0017). O trigger recusa e a migration morre na limpeza.
  --
  -- Então a sonda roda num sub-bloco que SEMPRE termina em exceção. Em
  -- PL/pgSQL isso é um savepoint: o negócio e o evento somem no unwind. As
  -- variáveis, ao contrário das escritas, sobrevivem — é por elas que o
  -- resultado atravessa.
  BEGIN
    INSERT INTO public.deals (organization_id, title, source_lead_id, source)
    VALUES (v_org, 'sonda rls', v_lead, 'human') RETURNING id INTO v_d;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- Sem tratamento aqui: se a trava recusar, a exceção é check_violation,
    -- não a sentinela, e ela sobe e aborta a migration — que é o que se quer.
    UPDATE public.deals SET outcome = 'won' WHERE id = v_d;
    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    RESET ROLE;

    RAISE EXCEPTION 'sonda-concluida' USING ERRCODE = '22000';
  EXCEPTION WHEN sqlstate '22000' THEN
    NULL;  -- savepoint desfeito: negócio e evento da sonda não existiram
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);

  IF v_linhas <> 1 THEN
    RAISE EXCEPTION 'guarda nao exercitou nada: % linhas afetadas (RLS barrou antes do trigger)', v_linhas;
  END IF;
END $$;
