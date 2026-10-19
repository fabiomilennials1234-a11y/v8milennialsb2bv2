import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { evaluateGuidedCondition } from '../../supabase/functions/_shared/guided-condition';
import {
  GUIDED_OWNER_OPERATORS,
  isGuidedOwnerField,
} from '../../src/contracts/workflows/guided-fields';

// Chamado 793f4b05 · PR4b (decisão 5 do CTO): o operador "está entre os donos"
// olha TODOS os donos do lead (principais + co-donos); "responsável é X"
// continua olhando só o principal do papel. Só o transporte do banco é trocado
// por um fetch falso; a regra (RLS, grant) é verificada à parte.

const PRE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SALE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const STRANGER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const NAMES: Record<string, string> = { [PRE]: 'Ana', [SALE]: 'Marina', [CO]: 'Bia', [STRANGER]: 'Rita' };

type Call = { path: string; body: Record<string, unknown> };

function personalTest(ownerIds: unknown, calls: Call[] = []) {
  return createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const call = { path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : {} };
      calls.push(call);
      if (!url.pathname.endsWith('/rpc/test_guided_condition_responsibles')) {
        return new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } });
      }
      const ids = (call.body.p_member_ids as string[]) ?? [];
      const fieldValues: Record<string, unknown> = { pre_sale_responsible_id: PRE, sale_responsible_id: SALE };
      if (ownerIds !== undefined) fieldValues.owner_member_ids = ownerIds;
      return new Response(JSON.stringify([{
        field_values: fieldValues,
        members: ids.map(id => ({ id, name: NAMES[id.toLowerCase()] ?? 'x' })),
      }]), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
}

const owners = (memberId: string, id = 'owners') =>
  ({ version: 1, id, field: 'lead.owners', operator: 'owner_includes', memberId }) as const;

describe('guided condition — owner_includes (lead.owners)', () => {
  it('declara o campo e o operador no contrato', () => {
    expect(isGuidedOwnerField('lead.owners')).toBe(true);
    expect(isGuidedOwnerField('lead.sale_responsible_id')).toBe(false);
    expect(GUIDED_OWNER_OPERATORS.owner_includes).toBe('está entre os donos');
  });

  it('co-dono (que não é principal) satisfaz "está entre os donos"', async () => {
    const calls: Call[] = [];
    const result = await evaluateGuidedCondition(personalTest([SALE, PRE, CO], calls), {
      organizationId: 'org-1', leadId: 'lead-1', condition: owners(CO.toUpperCase()),
    });
    expect(result).toEqual({ status: 'evaluated', matched: true, rules: [
      { id: 'owners', status: 'evaluated', matched: true, actual: [SALE, PRE, CO], reference: { id: CO, name: 'Bia' } },
    ] });
    const rpc = calls.find(call => call.path.endsWith('/rpc/test_guided_condition_responsibles'))!;
    expect(rpc.body.p_fields).toEqual(['lead.owners']);
  });

  it('quem não é dono dá falso', async () => {
    const result = await evaluateGuidedCondition(personalTest([SALE, PRE, CO]), {
      organizationId: 'org-1', leadId: 'lead-1', condition: owners(STRANGER),
    });
    expect(result).toMatchObject({ status: 'evaluated', matched: false });
  });

  it('lead sem dono nenhum dá falso, sem erro', async () => {
    const result = await evaluateGuidedCondition(personalTest([]), {
      organizationId: 'org-1', leadId: 'lead-1', condition: owners(CO),
    });
    expect(result).toMatchObject({ status: 'evaluated', matched: false });
  });

  it('"responsável é X" segue no principal: co-dono NÃO é o responsável de vendas', async () => {
    const coIsSale = await evaluateGuidedCondition(personalTest([SALE, PRE, CO]), {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'sale-is-co', field: 'lead.sale_responsible_id', operator: 'equals', memberId: CO },
    });
    expect(coIsSale).toMatchObject({ status: 'evaluated', matched: false });
    const solo = await evaluateGuidedCondition(personalTest([SALE, PRE, CO]), {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'sale-is-sale', field: 'lead.sale_responsible_id', operator: 'equals', memberId: SALE },
    });
    expect(solo).toMatchObject({ status: 'evaluated', matched: true });
  });

  it('pede os escopos de responsável e de donos juntos num só round-trip', async () => {
    const calls: Call[] = [];
    await evaluateGuidedCondition(personalTest([SALE, CO], calls), {
      organizationId: 'org-1', leadId: 'lead-1', condition: { version: 1, id: 'g', kind: 'group', match: 'any', children: [
        { version: 1, id: 'sale', field: 'lead.sale_responsible_id', operator: 'equals', memberId: SALE },
        owners(CO),
      ] },
    });
    const rpcs = calls.filter(call => call.path.endsWith('/rpc/test_guided_condition_responsibles'));
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].body.p_fields).toEqual(['lead.sale_responsible_id', 'lead.owners']);
    expect((rpcs[0].body.p_member_ids as string[]).sort()).toEqual([CO, SALE].sort());
  });

  it('execução organizacional lê pelo leitor autorizado e usa owner_member_ids', async () => {
    const urls: string[] = [];
    const database = createClient('https://db.example.test', 'test-service-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        urls.push(new URL(String(input)).pathname);
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body.p_fields).toEqual(['lead.owners']);
        return new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1', field_values: {
          responsibles: { field_values: { owner_member_ids: [SALE, CO] }, members: [{ id: CO, name: 'Bia' }] },
        } }), { headers: { 'Content-Type': 'application/json' } });
      } },
    });
    const result = await evaluateGuidedCondition(database, {
      organizationId: 'org-1', leadId: 'lead-1', authorization: { kind: 'organization', workflowId: 'workflow-1' },
      condition: owners(CO),
    });
    expect(urls).toEqual(['/rest/v1/rpc/read_guided_condition_data']);
    expect(result).toMatchObject({ status: 'evaluated', matched: true });
  });

  it('rejeita memberId que não é UUID', async () => {
    expect(await evaluateGuidedCondition(personalTest([]), {
      organizationId: 'org-1', leadId: 'lead-1', condition: owners('Bia'),
    })).toEqual({ status: 'error', code: 'invalid_configuration' });
  });

  it('rejeita operador de responsável em lead.owners', async () => {
    expect(await evaluateGuidedCondition(personalTest([]), {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'x', field: 'lead.owners', operator: 'equals', memberId: CO } as never,
    })).toEqual({ status: 'error', code: 'invalid_configuration' });
  });

  it.each([
    ['ausente', undefined],
    ['não é lista', SALE],
    ['item não UUID', ['Bia']],
  ])('owner_member_ids %s é falha de fonte, nunca "não dono"', async (_label, bad) => {
    expect(await evaluateGuidedCondition(personalTest(bad), {
      organizationId: 'org-1', leadId: 'lead-1', condition: owners(CO),
    })).toEqual({ status: 'error', code: 'source_unavailable' });
  });
});
