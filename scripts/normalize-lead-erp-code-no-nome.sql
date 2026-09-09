-- normalize-lead-erp-code-no-nome.sql
--
-- Tira o código do ERP de DENTRO de `leads.name` e o move para `leads.erp_code`,
-- onde a camada de exibição sabe pintá-lo.
--
-- Por que existe: antes de a feature existir, o vendedor digitava o código no
-- próprio nome ("15794 - Robson Rinaldi"). Isso produz três problemas que só o
-- saneamento resolve:
--   1. o código sai em NEGRITO (é parte do nome) enquanto o resto da base sai
--      em cinza — o formato fica "quase" igual, que é pior que diferente;
--   2. `{{nome}}` de disparo e a saudação do Copilot mandam "Olá 15794 -
--      Robson Rinaldi" para o cliente;
--   3. `leads.erp_code` fica NULL, então a busca por código não acha o lead que
--      exibe o código.
--
-- ⚠️ ORDEM: rodar DEPOIS de `scripts/backfill-lead-erp-code.sql`. O backfill
-- carimba `erp_code` a partir do vínculo com `upsell_clients`, que é evidência
-- mais forte que o que alguém digitou; este script só preenche o que sobrou
-- NULL e nunca sobrescreve.
--
-- ⚠️ É FOTOGRAFIA, não trava. Medido em 2026-09-03: 6 leads com código no nome
-- foram criados NAQUELE dia — o hábito é corrente. Rode de novo depois que a
-- feature estiver no ar e o time parar de digitar. É idempotente: nome já limpo
-- não casa o padrão.
--
-- ## O que ele NÃO toca, de propósito
--
-- - Nome cujo prefixo não é um `external_id` REAL da mesma org. Só 26 de 260
--   leads com formato "algo - resto" têm código de verdade; os outros 234 são
--   nome com hífen ("KAFFE-KANTATE"), e mexer neles seria estrago.
-- - `16657 - Bru Leite` — o código 16657 não existe como cliente na org. Pode
--   ser erro de digitação ou cliente fora do recorte de marcas. Sem prova, não
--   se mexe.
-- - Lead cujo `erp_code` já gravado DIVERGE do prefixo digitado. Aí o vínculo e
--   a digitação discordam, e apagar o nome perderia a única pista da
--   divergência. Fica para inspeção humana (a consulta de conferência abaixo os
--   lista).
-- - Nome que ficaria VAZIO ("1234 - "). Medido: 0 casos, mas a guarda fica.
-- - `upsell_clients.name` — medido: 0 clientes da carteira com código no nome.
--
-- ## Conferência ANTES (o que será alterado)
--
--   SELECT l.name AS antes,
--          substring(l.name from '^\s*([^\s\-–:]+)\s*[-–:]\s*') AS codigo,
--          btrim(regexp_replace(l.name, '^\s*[^\s\-–:]+\s*[-–:]\s*', '')) AS depois
--     FROM public.leads l
--    WHERE l.deleted_at IS NULL
--      AND l.name ~ '^\s*[^\s\-–:]+\s*[-–:]\s*'
--      AND EXISTS (SELECT 1 FROM public.upsell_clients k
--                   WHERE k.organization_id = l.organization_id
--                     AND k.external_id = substring(l.name from '^\s*([^\s\-–:]+)\s*[-–:]\s*'))
--    ORDER BY 1;

WITH alvo AS (
  SELECT l.id,
         substring(l.name from '^\s*([^\s\-–:]+)\s*[-–:]\s*')          AS codigo,
         btrim(regexp_replace(l.name, '^\s*[^\s\-–:]+\s*[-–:]\s*', '')) AS resto
  FROM public.leads l
  WHERE l.deleted_at IS NULL
    AND l.name ~ '^\s*[^\s\-–:]+\s*[-–:]\s*'
    -- Recorta cedo para a varredura não passar por todas as orgs: só org que
    -- tem ERP pode ter código no nome. Sem isto o regex sobre a base inteira
    -- estoura o statement timeout.
    AND l.organization_id IN (
      SELECT DISTINCT organization_id FROM public.upsell_clients WHERE external_id IS NOT NULL
    )
)
UPDATE public.leads l
SET    erp_code = COALESCE(l.erp_code, a.codigo),
       name     = a.resto
FROM   alvo a
WHERE  a.id = l.id
  -- Nunca deixa o lead sem nome.
  AND  a.resto <> ''
  -- Não sobrescreve o que o vínculo com a carteira já provou, e não mexe onde
  -- os dois discordam.
  AND  (l.erp_code IS NULL OR l.erp_code = a.codigo)
  -- 🔑 A prova: o prefixo tem que ser um código REAL de cliente da MESMA org.
  -- É o que separa "15794 - Robson Rinaldi" de "KAFFE-KANTATE TORREFACAO".
  AND  EXISTS (
    SELECT 1 FROM public.upsell_clients k
     WHERE k.organization_id = l.organization_id
       AND k.external_id = a.codigo
  );

-- ## Conferência DEPOIS — tem que devolver 0
--
--   SELECT count(*) FROM public.leads l
--    WHERE l.deleted_at IS NULL
--      AND l.name ~ '^\s*[^\s\-–:]+\s*[-–:]\s*'
--      AND EXISTS (SELECT 1 FROM public.upsell_clients k
--                   WHERE k.organization_id = l.organization_id
--                     AND k.external_id = substring(l.name from '^\s*([^\s\-–:]+)\s*[-–:]\s*'));
--
-- ## Divergências deixadas para inspeção humana
--
--   SELECT l.name, l.erp_code,
--          substring(l.name from '^\s*([^\s\-–:]+)\s*[-–:]\s*') AS digitado
--     FROM public.leads l
--    WHERE l.deleted_at IS NULL
--      AND l.name ~ '^\s*[^\s\-–:]+\s*[-–:]\s*'
--      AND l.erp_code IS NOT NULL
--      AND l.erp_code <> substring(l.name from '^\s*([^\s\-–:]+)\s*[-–:]\s*');
