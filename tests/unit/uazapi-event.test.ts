// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { uazapiEventMessage, uazapiMessageReaction, mergeUazapiReaction, uazapiMessageEdit } from '../../supabase/functions/_shared/uazapi-event';
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

// Shapes from prod raw_payload (Chamado 4b8d5fd1), identifiers replaced.
describe('uazapiMessageEdit', () => {
  const textEdit = {
    id: '5511888888888:EDIT1', messageid: 'EDIT1', edited: 'ORIGINAL1', type: 'text',
    messageType: 'ExtendedTextMessage', fromMe: true, text: 'texto novo', content: { text: 'texto novo' },
  };
  const captionEdit = {
    id: '5511888888888:EDIT2', messageid: 'EDIT2', edited: 'ORIGINAL2', type: 'text',
    messageType: 'DocumentMessage', fromMe: true, text: '', content: { caption: 'legenda nova' },
  };

  it('extracts the original id and the new text of a text edit', () => {
    expect(uazapiMessageEdit(textEdit)).toEqual({ originalId: 'ORIGINAL1', text: 'texto novo' });
  });

  it('takes the caption of a media edit even though top-level text is empty', () => {
    expect(uazapiMessageEdit(captionEdit)).toEqual({ originalId: 'ORIGINAL2', text: 'legenda nova' });
  });

  it('falls back to top-level text when content has no body', () => {
    expect(uazapiMessageEdit({ edited: 'ORIGINAL3', text: 'só no topo', content: '' }))
      .toEqual({ originalId: 'ORIGINAL3', text: 'só no topo' });
  });

  it('keeps an emptied caption as an empty string (removal is an edit)', () => {
    expect(uazapiMessageEdit({ edited: 'ORIGINAL4', text: '', content: { caption: '' } }))
      .toEqual({ originalId: 'ORIGINAL4', text: '' });
  });

  it('reports no text instead of inventing one', () => {
    expect(uazapiMessageEdit({ edited: 'ORIGINAL5', content: {} })).toEqual({ originalId: 'ORIGINAL5', text: null });
  });

  it.each([
    ['empty string (ordinary message)', ''],
    ['blank string', '   '],
    ['missing', undefined],
    ['boolean (messages_update shape)', true],
    ['null', null],
  ])('returns null when edited is %s', (_label, edited) => {
    expect(uazapiMessageEdit({ ...textEdit, edited })).toBeNull();
  });
});
