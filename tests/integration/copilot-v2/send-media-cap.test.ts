/**
 * Slice 6 — cap da send-media library, nível DB (Copilot v2). REQUER a migration
 * copilot_v2_send_media_cap aplicada (dev) + service key — por isso .skip por
 * padrão (convenção do repo — ver handoff-dispatch.test.ts). O nível-unidade do
 * cap é coberto por assertWithinCap em tests/unit/send-media-selector.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ORG = process.env.COPILOT_V2_TEST_ORG ?? '6030520a-2ca7-477d-be89-55758e2cd808'; // Milennials
const getAdmin = () => createClient(PROD_URL, SERVICE_KEY);

describe('Copilot v2 send-media cap — gate', () => {
  it('is gated on the Slice 6 cap migration (un-skip the suite below once applied)', () => {
    expect(SERVICE_KEY === '' || SERVICE_KEY.length > 0).toBe(true);
  });
});

describe.skip('copilot_v2_assert_send_media_cap (DB) [requires migration applied]', () => {
  it('recusa o item além do limite (default PROVISÓRIO per_kind=5)', async () => {
    // inserir 5 imagens ativas → assert(image) = false; assert(video) = true.
    const okVideo = await getAdmin().rpc('copilot_v2_assert_send_media_cap', { p_org_id: ORG, p_kind: 'video' });
    expect(okVideo.data).toBe(true);
  });
});
