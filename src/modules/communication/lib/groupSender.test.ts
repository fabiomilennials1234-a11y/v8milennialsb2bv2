import { describe, it, expect } from 'vitest';
import { groupSender } from './groupSender';
describe('group sender', () => {
  it('uses the persisted participant name above the message, never the group name', () => {
    expect(groupSender({ direction: 'incoming', is_group: true, push_name: ' Ana ', raw_payload: { groupName: 'Vendas', sender_pn: '5548999999999@s.whatsapp.net' } })).toEqual({ name: 'Ana', key: '5548999999999@s.whatsapp.net' });
  });
  it('has parity between SELECT projections and realtime', () => {
    const common = {direction:'incoming',remote_jid:'120363123@g.us',push_name:'Ana'};
    expect(groupSender({...common,group_sender:'123:2@lid'})).toEqual(groupSender({...common,raw_payload:{sender:'123:2@lid'}}));
  });
  it('falls back to a phone, never a LID; does not label direct or outgoing messages', () => {
    expect(groupSender({direction:'incoming',is_group:true,group_sender_phone:'5548999999999@s.whatsapp.net'})?.name).toBe('+5548999999999');
    expect(groupSender({direction:'incoming',is_group:true,group_sender:'123@lid'})?.name).toBe('Participante sem nome');
    expect(groupSender({direction:'incoming',push_name:'Ana'})).toBeNull();
    expect(groupSender({direction:'outgoing',is_group:true,push_name:'Ana'})).toBeNull();
  });
});
