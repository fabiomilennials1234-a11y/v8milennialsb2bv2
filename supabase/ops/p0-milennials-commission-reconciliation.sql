-- Lote fechado, revisável, autorizado em 14/09/2026 pelo CTO:
-- "Sim, os percentuais atuais valiam" (julho a setembro/Milennials).
-- Classificação mrr mantém a regra vigente para metadata ausente; nenhuma
-- linha com tipo projeto foi encontrada neste lote. Validar antes de aplicar.
-- Executar autenticado como admin da org/master completo, após migrations P0.
-- Não é migration: não roda automaticamente no deploy de schema.
BEGIN;
DO $$
DECLARE v record; v_sale public.sale_events%ROWTYPE;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('e0d14878-0f35-42a0-ad1a-6cafed66e9ac'::uuid, 1700, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('f194d898-cbd6-4e07-b23f-79f43e8a96ee'::uuid, 5680, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('ea79ede2-cf59-4242-a324-690083f4742d'::uuid, 22760, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('3dfdb770-8a29-4446-8725-139001caf0c0'::uuid, 9600, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('06a79696-9950-4292-ba58-3332639abbb0'::uuid, 1260, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('72989918-c2d1-4e11-97df-2d8ea73149db'::uuid, 45468, '62048edc-920a-489c-bab9-13f2aaca0ce4'::uuid, 0, 'mrr'::public.product_type),
    ('18158e92-61d4-4a1f-bb52-3c02969f2737'::uuid, 21726, '62048edc-920a-489c-bab9-13f2aaca0ce4'::uuid, 0, 'mrr'::public.product_type),
    ('b32ea77c-5b09-4610-ba51-4e3b37e15c85'::uuid, 12760, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('7ae50694-6be0-4f3f-97f6-d95b277287db'::uuid, 8650, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('af09545b-0a65-46fe-bad1-a2d9e6e0ff96'::uuid, 12760, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('8f765ea6-b3cd-4824-a08e-70c6cf7f3dff'::uuid, 5350, '62048edc-920a-489c-bab9-13f2aaca0ce4'::uuid, 0, 'mrr'::public.product_type),
    ('62c65666-2964-49c1-8489-ae4aa6e61684'::uuid, 3630, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('49a7b293-ee0d-4cc1-b7c7-08065526234f'::uuid, 4690, '62048edc-920a-489c-bab9-13f2aaca0ce4'::uuid, 0, 'mrr'::public.product_type),
    ('5d7e4d9f-0687-466f-bb39-92920e4e3a5e'::uuid, 3920, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('3654471d-166e-4e3b-b9ac-e8a59f53357f'::uuid, 5430, '62048edc-920a-489c-bab9-13f2aaca0ce4'::uuid, 0, 'mrr'::public.product_type),
    ('aabde384-f104-4e6c-92d1-dc6bd2281e55'::uuid, 3000, '62048edc-920a-489c-bab9-13f2aaca0ce4'::uuid, 0, 'mrr'::public.product_type),
    ('ada6d5fa-deed-45b3-95c7-4ca4b9b1a61b'::uuid, 4420, '62048edc-920a-489c-bab9-13f2aaca0ce4'::uuid, 0, 'mrr'::public.product_type),
    ('43c96700-ade0-4baf-af75-88ffa0d84024'::uuid, 2980, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('d5eef113-711e-49f4-bde1-a495fe63fca8'::uuid, 3980, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('87823b12-f8f2-4638-80c7-161d32c27b24'::uuid, 5000, '62048edc-920a-489c-bab9-13f2aaca0ce4'::uuid, 0, 'mrr'::public.product_type),
    ('dd143c15-f35a-4562-b640-684ae47f0c52'::uuid, 2500, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type),
    ('70b13847-19e9-4271-82c6-53e3b02f5547'::uuid, 3190, '43380940-a044-4809-b264-2fa74530480c'::uuid, 1, 'mrr'::public.product_type)
  ) AS manifest(event_id,expected_value,expected_member,confirmed_rate,confirmed_type)
  LOOP
    SELECT * INTO v_sale FROM public.sale_events WHERE id=v.event_id FOR UPDATE;
    IF NOT FOUND OR v_sale.organization_id <> '6030520a-2ca7-477d-be89-55758e2cd808'::uuid
      OR v_sale.sale_value IS DISTINCT FROM v.expected_value
      OR v_sale.sale_responsible_id IS DISTINCT FROM v.expected_member THEN
      RAISE EXCEPTION 'Lote divergente: %, conferir novamente antes de aplicar',v.event_id;
    END IF;
    PERFORM public.reconciliar_comissao_historica(v.event_id,v.confirmed_rate,v.confirmed_type,
      'CTO confirmou em 14/09/2026: percentuais atuais também valiam de julho a setembro. Tipo MRR conforme regra vigente (metadata ausente usa MRR).');
  END LOOP;
END $$;
SELECT public.get_commission_ledger('6030520a-2ca7-477d-be89-55758e2cd808','month','2026-09-01');
COMMIT;
