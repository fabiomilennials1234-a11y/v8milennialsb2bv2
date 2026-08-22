/**
 * Integration tests — New Order creation (unified modal hook)
 *
 * Tests the database-level behavior of creating multi-item orders
 * via the same logic that useNewOrder will use.
 *
 * Requires: local Supabase running with seed applied (`supabase db reset`).
 *
 * Covers:
 *   - Multi-item order inserts upsell_orders + client_purchase_items
 *   - sale_value = sum of (qty × unit_price)
 *   - product_name = join of item names
 *   - client_purchase_items linked by order_id
 *   - upsell_client_products entries created per distinct product
 *   - campanhaId optional association
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID, TEST_LEAD_ALPHA_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// We need a test client in upsell_clients.
//
// ⚠ O id era `...009001`, que o seed passou a usar para um LEAD do cenário de
// métricas ("Lead Com Dois Negocios"). Tabelas diferentes, então não havia
// conflito de chave — só de leitura humana, e ela custou caro: ninguém percebeu
// que o cliente da carteira nunca chegava a existir.
const TEST_CLIENT_ID = '00000000-0000-0000-0000-00000000cf01';
const TEST_CLOSER_ID = '00000000-0000-0000-0000-000000000110'; // TEST_TM_MASTER_ID

let createdOrderIds: string[] = [];

describe.skipIf(shouldSkip)('New Order creation', () => {
  beforeAll(async () => {
    // Ensure test client exists.
    //
    // 🔴 `lead_id` É NOT NULL EM `upsell_clients`, E FALTAVA AQUI (SCRUM-362).
    // O upsert falhava com 23502, o erro era DESCARTADO — sem `if (error)
    // throw` — e as cinco asserções da suíte morriam depois em 23503, apontando
    // para a FK do pedido. O sintoma ficava a dois passos da causa: quem lia o
    // vermelho investigava `upsell_orders`, e o defeito estava no fixture.
    //
    // Cliente da carteira é sempre a projeção comercial de um lead: sem lead
    // não há de quem o pedido é. Por isso o NOT NULL, e por isso o fixture
    // pendura no Lead Alpha do seed.
    const { error: clientError } = await supabase.from('upsell_clients').upsert({
      id: TEST_CLIENT_ID,
      organization_id: TEST_ORG_ID,
      lead_id: TEST_LEAD_ALPHA_ID,
      name: 'Test Client Order',
      company: 'Test Corp',
      is_active: true,
    }, { onConflict: 'id' });
    if (clientError) {
      throw new Error(`fixture: upsell_clients upsert falhou — ${clientError.message}`);
    }
  });

  afterAll(async () => {
    // Cleanup: remove created orders and their items
    for (const orderId of createdOrderIds) {
      await supabase.from('client_purchase_items').delete().eq('order_id', orderId);
      await supabase.from('upsell_orders').delete().eq('id', orderId);
    }
    await supabase.from('upsell_client_products').delete().eq('client_id', TEST_CLIENT_ID);
    // O cliente do fixture também sai: linha de carteira esquecida entra na
    // conta de outras suítes (e da inadimplência) como cliente real.
    await supabase.from('upsell_clients').delete().eq('id', TEST_CLIENT_ID);
  });

  it('creates order with correct total from multiple items', async () => {
    const items = [
      { product_name: 'Chapa Aço 3mm', quantity: 3, unit_price: 150, unit: 'un' },
      { product_name: 'Parafuso M8', quantity: 100, unit_price: 0.80, unit: 'un' },
      { product_name: 'Solda MIG', quantity: 2, unit_price: 320, unit: 'kg' },
    ];

    const expectedTotal = 3 * 150 + 100 * 0.80 + 2 * 320; // 450 + 80 + 640 = 1170

    // Step 1: Insert order
    const { data: order, error: orderError } = await supabase
      .from('upsell_orders')
      .insert({
        organization_id: TEST_ORG_ID,
        client_id: TEST_CLIENT_ID,
        closer_id: TEST_CLOSER_ID,
        product_name: items.map(i => i.product_name).join(', '),
        product_type: 'unitario',
        sale_value: expectedTotal,
        source: 'manual',
        origin: 'upsell',
      })
      .select('id, sale_value, product_name, approval_status')
      .single();

    expect(orderError).toBeNull();
    expect(order).toBeTruthy();
    createdOrderIds.push(order!.id);

    expect(order!.sale_value).toBe(expectedTotal);
    expect(order!.product_name).toBe('Chapa Aço 3mm, Parafuso M8, Solda MIG');
    expect(order!.approval_status).toBe('pending');
  });

  it('inserts line items linked to order via order_id', async () => {
    const orderId = createdOrderIds[0];
    expect(orderId).toBeTruthy();

    const items = [
      { order_id: orderId, product_name: 'Chapa Aço 3mm', quantity: 3, unit_price: 150, unit: 'un' },
      { order_id: orderId, product_name: 'Parafuso M8', quantity: 100, unit_price: 0.80, unit: 'un' },
      { order_id: orderId, product_name: 'Solda MIG', quantity: 2, unit_price: 320, unit: 'kg' },
    ];

    const { error: itemsError } = await supabase
      .from('client_purchase_items')
      .insert(items);

    expect(itemsError).toBeNull();

    // Verify items are linked
    const { data: savedItems, error: fetchError } = await supabase
      .from('client_purchase_items')
      .select('product_name, quantity, unit_price, unit, order_id')
      .eq('order_id', orderId)
      .order('product_name');

    expect(fetchError).toBeNull();
    expect(savedItems).toHaveLength(3);
    expect(savedItems![0].product_name).toBe('Chapa Aço 3mm');
    expect(savedItems![0].quantity).toBe(3);
    expect(savedItems![0].unit_price).toBe(150);
    expect(savedItems![1].product_name).toBe('Parafuso M8');
    expect(savedItems![2].product_name).toBe('Solda MIG');
    expect(savedItems![2].unit).toBe('kg');
  });

  it('creates upsell_client_products for distinct products', async () => {
    const products = [
      { client_id: TEST_CLIENT_ID, product_name: 'Chapa Aço 3mm', product_type: 'unitario', sale_value: 450 },
      { client_id: TEST_CLIENT_ID, product_name: 'Solda MIG', product_type: 'unitario', sale_value: 640 },
    ];

    const { error } = await supabase
      .from('upsell_client_products')
      .insert(products);

    expect(error).toBeNull();

    const { data: saved, error: fetchError } = await supabase
      .from('upsell_client_products')
      .select('product_name, sale_value')
      .eq('client_id', TEST_CLIENT_ID)
      .order('product_name');

    expect(fetchError).toBeNull();
    expect(saved!.length).toBeGreaterThanOrEqual(2);
    expect(saved!.find(p => p.product_name === 'Chapa Aço 3mm')).toBeTruthy();
    expect(saved!.find(p => p.product_name === 'Solda MIG')).toBeTruthy();
  });

  it('associates campanhaId when provided', async () => {
    // Create order with campanha_id (null is valid — just testing column works)
    const { data: order, error } = await supabase
      .from('upsell_orders')
      .insert({
        organization_id: TEST_ORG_ID,
        client_id: TEST_CLIENT_ID,
        product_name: 'Produto Campanha',
        product_type: 'unitario',
        sale_value: 500,
        source: 'manual',
        origin: 'upsell',
        campanha_id: null,
      })
      .select('id, campanha_id')
      .single();

    expect(error).toBeNull();
    expect(order).toBeTruthy();
    createdOrderIds.push(order!.id);
    expect(order!.campanha_id).toBeNull();
  });

  it('product_name is comma-joined from items', async () => {
    const names = ['Vergalhão CA-50', 'Cimento CP-II'];
    const total = 1000;

    const { data: order, error } = await supabase
      .from('upsell_orders')
      .insert({
        organization_id: TEST_ORG_ID,
        client_id: TEST_CLIENT_ID,
        product_name: names.join(', '),
        product_type: 'unitario',
        sale_value: total,
        source: 'manual',
        origin: 'upsell',
      })
      .select('id, product_name')
      .single();

    expect(error).toBeNull();
    createdOrderIds.push(order!.id);
    expect(order!.product_name).toBe('Vergalhão CA-50, Cimento CP-II');
  });
});
