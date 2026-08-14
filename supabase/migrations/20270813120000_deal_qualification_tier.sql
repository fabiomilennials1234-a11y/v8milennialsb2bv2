-- 20270813120000_deal_qualification_tier.sql
--
-- A QUALIFICAÇÃO PASSA A SER DO NEGÓCIO. A PRÉ-QUALIFICAÇÃO CONTINUA DA PESSOA.
--
-- Hoje `leads` carrega as duas: `pre_qualification_tier` e
-- `qualification_tier`. Sob a unidade nova do funil (ADR-0023, o Negócio é o
-- que anda), isso mistura duas perguntas diferentes:
--
--   pré-qualificação → "vale a pena falar com esta PESSOA?"  ...................  do Lead
--   qualificação     → "esta OPORTUNIDADE é boa?"            ...................  do Negócio
--
-- Um lead com três negócios tem uma pré-qualificação e pode ter três
-- qualificações distintas — a reposição trimestral é ouro, o teste de amostra é
-- bronze. Com uma coluna só na pessoa, a segunda avaliação apaga a primeira.
--
-- 🔴 POR QUE ACRESCENTAR EM VEZ DE MOVER
--
-- `leads.qualification_tier` é lido pelo motor de métricas em QUATRO medidas —
-- `leads_avaliados`, `leads_nao_avaliados`, `boas_avaliacoes` e a razão
-- `taxa_qualidade` (migrations 20270811130000, 20270812020000, 20270812030000,
-- 20270812100000). Mover a coluna mudaria o número dessas quatro sem que
-- ninguém tenha pedido, e a família inteira passaria a medir outra coisa
-- calada.
--
-- Então esta migration só ABRE o caminho: cria a coluna no negócio, deixa a do
-- lead intacta, e não toca em leaf nenhuma. Repontar as medidas para o negócio
-- é decisão de produto com número em jogo — fatia própria, com o CTO ciente de
-- que o histórico da família de qualidade muda de base.
--
-- O ENUM É O MESMO, DE PROPÓSITO
--
-- `diamante | ouro | prata | bronze | desqualificado` — o mesmo vocabulário da
-- pessoa. Duas escalas para a mesma ideia obrigariam o vendedor a aprender
-- duas, e a tela usa a mesma paleta nas duas pontas.
--
-- DDL PURA (guarda F4): coluna, CHECK e índice. Nenhum dado é migrado — negócio
-- nasce sem qualificação, e quem avalia é quem trabalha o negócio.
--
-- ROLLBACK pareado: rollback/20270813120000_deal_qualification_tier.sql

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS qualification_tier text;

DO $ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_qualification_tier_check'
      AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_qualification_tier_check
      CHECK (qualification_tier IS NULL OR qualification_tier IN
             ('diamante', 'ouro', 'prata', 'bronze', 'desqualificado'));
  END IF;
END
$ck$;

COMMENT ON COLUMN public.deals.qualification_tier IS
  'Qualidade desta OPORTUNIDADE (ADR-0023). Distinta de '
  '`leads.pre_qualification_tier`, que qualifica a PESSOA. Um lead com vários '
  'negócios tem uma pré-qualificação e várias qualificações. '
  'NÃO é lida pelo motor de métricas: a família de qualidade '
  '(leads_avaliados, boas_avaliacoes, taxa_qualidade) continua em '
  '`leads.qualification_tier` até decisão explícita de repontar.';

-- Índice parcial: só os avaliados. A grande maioria dos negócios nasce e morre
-- sem nota, e indexar NULL seria pagar por linha que nunca entra em filtro.
CREATE INDEX IF NOT EXISTS idx_deals_qualification_tier
  ON public.deals (organization_id, qualification_tier)
  WHERE qualification_tier IS NOT NULL;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals'
      AND column_name = 'qualification_tier'
  ) THEN
    RAISE EXCEPTION 'GUARDA: deals.qualification_tier não foi criada';
  END IF;

  -- A da PESSOA tem de continuar de pé: as quatro medidas da família de
  -- qualidade leem dela, e esta migration se comprometeu a não tocá-las.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads'
      AND column_name = 'qualification_tier'
  ) THEN
    RAISE EXCEPTION 'GUARDA: leads.qualification_tier sumiu — a família de qualidade perdeu a base';
  END IF;
END
$guard$;
