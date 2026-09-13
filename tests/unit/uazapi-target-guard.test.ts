// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { extractChatTarget, isChatTargetAllowed } from '../../supabase/functions/_shared/chat-owner-guard';
describe('UAZAPI additional actions retain conversation authorization', () => {
  it.each(['requestHistory', 'sendLocation', 'sendContact', 'blockUser', 'unblockUser'])('protects %s with the selected recipient', async action => {
    const target = extractChatTarget(action, { number: '5511999999999@s.whatsapp.net' });
    expect(target?.rawPhone).toBe('5511999999999@s.whatsapp.net');
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    expect(await isChatTargetAllowed({ rpc }, 'org', 'instance', target!)).toBe(false);
    expect(rpc).toHaveBeenCalledWith('can_see_chat_target', expect.objectContaining({ p_org_id: 'org', p_instance_id: 'instance', p_raw_phone: target!.rawPhone }));
  });
});
