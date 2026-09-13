// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { uazapiEventMessage, uazapiMessageReaction, mergeUazapiReaction } from '../../supabase/functions/_shared/uazapi-event';
const fixture = {
  EventType: 'messages', chat: { wa_chatid: '5511999999999@s.whatsapp.net', wa_chatlid: '123@lid' },
  message: { id: 'owner:REACTION', type: 'reaction', messageType: 'ReactionMessage', fromMe: true,
    chatid: '123@lid', sender: '5511888888888@s.whatsapp.net',
    content: { key: { ID: 'ORIGINAL', fromMe: true }, text: '🧪' } },
};
describe('UAZAPI real SSE envelope contract (identifiers replaced)', () => {
  it('resolves an object chat while preserving the original envelope', () => {
    expect(uazapiEventMessage(fixture)._phone_jid).toBe(fixture.chat.wa_chatid);
    expect(fixture.message).not.toHaveProperty('_phone_jid');
  });
  it('preserves group identity and never substitutes a participant phone', () => {
    expect(uazapiEventMessage({ ...fixture, chat: { wa_chatid: '999@g.us', phone: '5511999999999' } })._phone_jid).toBe('999@g.us');
  });
  it('does not inject a LID as a phone', () => {
    expect(uazapiEventMessage({ ...fixture, chat: { wa_chatid: '123@lid' } })).not.toHaveProperty('_phone_jid');
  });
  it('supports legacy envelopes and rejects scalar message data', () => {
    expect(uazapiEventMessage({ data: { text: 'test' }, chat: '5511999999999@s.whatsapp.net' }).text).toBe('test');
    expect(() => uazapiEventMessage({ message: 'invalid' })).toThrow();
  });
  it('uses target ID instead of the reaction ID', () => {
    expect(uazapiMessageReaction(fixture.message)).toMatchObject({ messageId: 'ORIGINAL', emoji: '🧪', from: 'me' });
    expect(uazapiMessageReaction({ type: 'text' })).toBeNull();
    expect(() => uazapiMessageReaction({ type: 'reaction' })).toThrow();
  });
  it('replays idempotently, replaces the same sender and preserves other senders', () => {
    const reaction = uazapiMessageReaction(fixture.message)!;
    const other = { emoji: '👍', from: 'them', sender: 'other', count: 1 };
    const once = mergeUazapiReaction([other], reaction);
    expect(mergeUazapiReaction(once, reaction)).toEqual(once);
    const replaced = mergeUazapiReaction(once, { ...reaction, emoji: '✅' });
    expect(replaced.map(r => r.emoji)).toEqual(['👍', '✅']);
    expect(mergeUazapiReaction(replaced, { ...reaction, emoji: '' })).toEqual([other]);
  });
});
