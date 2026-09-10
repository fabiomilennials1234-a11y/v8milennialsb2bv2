-- Operação de dados separada das migrations. Executar após publicar a função.
BEGIN;
UPDATE public.organizations
SET feature_flags = coalesce(feature_flags, '{}'::jsonb)
  || '{"toth_clientes_ativos_inconsistentes_com_representante":true}'::jsonb
WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

-- Cadastro elegível independe de compra recente. Manter marcas, necessárias
-- para a consulta do Toth; não exigir pedido faturado nem janela de compra.
UPDATE public.toth_connections
SET clientes_situacoes = '0,3', clientes_dias_compras = NULL,
    clientes_somente_com_compra = false, clientes_empresa = 'CAFE JURERE',
    clientes_incluir_sem_empresa = false, clientes_cursor = 1
WHERE organization_id = '4922638c-4909-494e-ba10-12282ec0b161';
COMMIT;
