-- ============================================================================
-- #1775 — o auto-seed de card em inserção de Lead para de criar
--
-- ADR-0030 §3: nenhum Workflow é semeado no lugar. Quem abre posição em funil
-- passa a ser sempre uma decisão explícita — a tela, a API com chave escopada,
-- ou um Workflow que a organização ativou.
--
-- O QUE MORRE: o CONSTRAINT TRIGGER `trg_auto_assign_lead_default_pipe` em
-- `public.leads` (AFTER INSERT, DEFERRABLE INITIALLY DEFERRED), que semeava
-- whatsapp/<etapa ativa> em todo Lead inserido.
--
-- O QUE FICA: a função `fn_auto_assign_lead_default_pipe`. Ela sai de circulação
-- sem ser apagada, de propósito — é o corpo que documenta como o auto-seed
-- decidia (guards de origem 'cal', de entry existente, de etapa fantasma), e o
-- rollback desta migration é uma linha por causa disso. Ela também carrega a
-- ÚLTIMA leitura de `deal_manual_only` que restava em produção, e a flag foi
-- aposentada no #1774: fora do gatilho, ninguém mais a lê.
--
-- POR QUE ISSO ENCERRA OS CARDS ÓRFÃOS: com o gatilho vivo e a flag desligada,
-- o card nascia e o Negócio não — porque o §3 do ADR-0023 só deixava um clique
-- humano abrir Negócio. Medido em produção: 11.721 cards órfãos, 259 criados nas
-- ~30h anteriores a 2026-08-24. Sem o gatilho, a fonte seca.
--
-- ⚠️ PRÉ-CONDIÇÃO OPERACIONAL, NÃO TÉCNICA — o aviso vai ANTES do corte.
-- Lista remedida em janela de 90 dias (a de 7 dias do handoff-l4 subestimava o
-- número de organizações e superestimava o volume das duas maiores):
--
--   46 organizações têm auto-seed em ~100% dos Leads. Delas, 18 passam de 20
--   cards por semana, somando 1.385 cards/semana:
--
--     Goletric Pinheiros   469/sem      Itatex                39/sem
--     Goletric Perdizes    264/sem      REALSC                33/sem
--     Motor 100            105/sem      VitrineVET            33/sem
--     Bennedita Pan         61/sem      Promove Consórcios    29/sem
--     testevideo            54/sem      London Cosmeticos     28/sem
--     Castropil             49/sem      SORVFOODS             26/sem
--     Basic4u               44/sem      Maycão                24/sem
--     Milennials            43/sem      Coopeafamijf          23/sem
--     Dna de Almas          40/sem      Forever Bella         21/sem
--
--   As outras 28 ficam abaixo de 20/semana (224 cards/semana no total).
--
-- Os cards que existem PERMANECEM: o funil não esvazia, para de encher. Mesmo
-- assim o primeiro sintoma para o vendedor é achar que sumiu lead — daí o aviso
-- em `.specs/features/lead-negocio-separacao/aviso-operacional-milennials.md`
-- ir primeiro.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_auto_assign_lead_default_pipe ON public.leads;

COMMENT ON FUNCTION public.fn_auto_assign_lead_default_pipe() IS
  'FORA DE CIRCULAÇÃO desde #1775 (2026-08-24): o gatilho que a chamava em public.leads foi removido. Mantida como documentação do auto-seed e para o rollback. Contém a última leitura de organizations.feature_flags.deal_manual_only, flag aposentada no #1774.';

COMMIT;
