-- 20270821140000_feature_catalog_leads_e_negocios.sql
--
-- SCRUM-409 — a nav anuncia duas coisas que o produto não tem mais.
--
-- `feature_catalog` é a fonte de verdade do catálogo de features (#1386), e o
-- que está lá em produção contradiz o produto em dois pontos. Medido em
-- 2026-08-21:
--
--   key     name                    display_name   sidebar_path
--   leads   Combustivel (Leads)     Combustivel    /leads
--   deals   Negócios                (null)         /negocios
--
-- 1) "Combustível" morreu com a unificação (SCRUM-2/SCRUM-4: "junção de
--    Carteira e Combustível, unificando tudo com o nome de LEADS"). A tela se
--    chama Leads; só a tela de plano e a de permissão continuam dizendo
--    Combustivel, porque leem daqui. Rótulo divergente faz um admin procurar
--    por "Combustível" uma aba que se chama "Leads".
--
-- 2) `/negocios` NÃO EXISTE como rota. Negócio vive dentro do funil e do card
--    do lead; a página autônoma não chegou a existir em develop. O caminho no
--    catálogo faz a sidebar montar um item com cadeado para uma rota que não
--    tem guard — e `tests/unit/route-feature-map.test.ts` reprova exatamente
--    isso, porque cadeado na nav sem guard na rota é contornável pela URL.
--
--    Zerar `sidebar_path` NÃO desliga a feature `deals`: ela continua no
--    catálogo, vendável, e governando o que já usa a chave. O que sai é a
--    promessa de uma página que não existe. Quando a página existir, é uma
--    linha de volta — com o guard no App.tsx junto.
--
-- Só metadado de plataforma: nenhuma linha de cliente é tocada.
--
-- ROLLBACK pareado: rollback/20270821140000_feature_catalog_leads_e_negocios.sql

UPDATE public.feature_catalog
   SET name = 'Leads',
       display_name = 'Leads'
 WHERE key = 'leads';

UPDATE public.feature_catalog
   SET sidebar_path = NULL
 WHERE key = 'deals';

-- Guarda: o catálogo gerado (`feature-catalog.generated.ts`) é commitado e
-- comparado com o banco por `tests/integration/feature-catalog-parity.test.ts`.
-- Falhar aqui é melhor que ver a divergência aparecer como teste vermelho três
-- passos adiante.
DO $guard$
DECLARE
  v_label text;
  v_path  text;
BEGIN
  SELECT COALESCE(display_name, name) INTO v_label FROM public.feature_catalog WHERE key = 'leads';
  IF v_label IS DISTINCT FROM 'Leads' THEN
    RAISE EXCEPTION 'GUARDA: rótulo de `leads` ficou %, esperado Leads', v_label;
  END IF;

  SELECT sidebar_path INTO v_path FROM public.feature_catalog WHERE key = 'deals';
  IF v_path IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: `deals` ainda anuncia sidebar_path %', v_path;
  END IF;
END
$guard$;
