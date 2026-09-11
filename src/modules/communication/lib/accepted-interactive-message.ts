import type { TablesInsert } from '@/integrations/supabase/types';
import { formatPhoneForWhatsApp } from './whatsapp';
import type { MenuMontado } from './menu-sender';

export interface AcceptedInteractiveResult {
  message_id?: string;
  status?: string;
  timestamp?: number;
}

type InteractiveContent =
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  | { kind: 'contact'; name: string; phone: string; email?: string }
  | { kind: 'menu'; menu: MenuMontado }
  | { kind: 'pix'; text: string; key: string; name: string; keyType: string };

/** Display fallback after acceptance. Never invent identity or promote queued to sent. */
export function acceptedInteractiveRow(
  scope: { organizationId: string; instanceId: string; phoneNumber: string },
  result: AcceptedInteractiveResult | undefined,
  content: InteractiveContent,
): TablesInsert<'whatsapp_messages'> | null {
  if (!result?.message_id?.trim() || !scope.organizationId) return null;
  const status = result.status?.toLowerCase();
  const timestamp = result.timestamp && Number.isFinite(result.timestamp)
    ? new Date(result.timestamp < 1e12 ? result.timestamp * 1000 : result.timestamp)
    : new Date();
  if (!Number.isFinite(timestamp.getTime())) return null;
  const base = {
    organization_id: scope.organizationId,
    instance_id: scope.instanceId,
    message_id: result.message_id,
    remote_jid: `${formatPhoneForWhatsApp(scope.phoneNumber)}@s.whatsapp.net`,
    phone_number: scope.phoneNumber,
    direction: 'outgoing',
    status: ['sent', 'delivered', 'read', 'failed'].includes(status ?? '') ? status! : 'pending',
    timestamp: timestamp.toISOString(),
  };
  if (content.kind === 'location') return {
    ...base, message_type: 'location',
    content: [content.name || 'Localização compartilhada', content.address,
      `https://www.google.com/maps?q=${content.latitude},${content.longitude}`].filter(Boolean).join('\n'),
  };
  if (content.kind === 'contact') return {
    ...base, message_type: 'contact',
    content: [content.name, content.phone, content.email].filter(Boolean).join('\n'),
  };
  if (content.kind === 'pix') return {
    ...base, message_type: 'pix-button', content: content.text,
    raw_payload: { sendPayload: { pixKey: content.key, pixName: content.name, pixType: content.keyType } },
  };
  const menu = content.menu;
  return {
    ...base, message_type: menu.tipo === 'button' ? 'button' : 'list',
    content: `${menu.texto}\n\n${menu.opcoes.map(option => `• ${option.title}`).join('\n')}`,
    raw_payload: menu.tipo === 'list' ? { source: 'torque_outbound_display', content: {
      description: menu.texto,
      sections: [{ title: '', rows: menu.opcoes.map(option => ({ title: option.title, description: option.description ?? '' })) }],
      buttonText: menu.rotuloDaLista || 'Ver opções', footerText: menu.rodape ?? '',
    } } : null,
  };
}

/** INSERT-ignore preserves an authoritative webhook echo, including receipts and content. */
export const interactiveInsertOptions = { onConflict: 'message_id,instance_id', ignoreDuplicates: true } as const;
