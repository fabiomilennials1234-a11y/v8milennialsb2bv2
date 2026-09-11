import { useState } from 'react';
import { Contact, MapPin, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCurrentTeamMember } from '@/modules/identity';
import { supabase } from '@/integrations/supabase/client';
import { sendContact, sendLocation } from '@/modules/communication/lib/whatsappApi';
import { acceptedInteractiveRow, interactiveInsertOptions, type AcceptedInteractiveResult } from '@/modules/communication/lib/accepted-interactive-message';
import { SendContactDialog } from '../social/SendContactDialog';
import { SendLocationDialog } from '../social/SendLocationDialog';

export function SendRichContactActions({ instanceId, phoneNumber, leadId, disabled }: {
  instanceId: string; phoneNumber: string; leadId?: string; disabled: boolean;
}) {
  const [dialog, setDialog] = useState<'location' | 'contact' | null>(null);
  const { data: member } = useCurrentTeamMember();
  const queryClient = useQueryClient();
  const checkScope = () => {
    if (disabled || !member?.organization_id) throw new Error('Envio indisponível nesta conversa');
    return { organizationId: member.organization_id, instanceId, phoneNumber };
  };
  const persist = async (scope: ReturnType<typeof checkScope>, result: AcceptedInteractiveResult, content: Parameters<typeof acceptedInteractiveRow>[2]) => {
    try {
      const row = acceptedInteractiveRow(scope, result, content);
      if (!row) throw new Error('Missing provider identity');
      const saved = await supabase.from('whatsapp_messages').upsert(row, interactiveInsertOptions);
      if (saved.error) throw saved.error;
    } catch {
      toast.warning('Envio aceito. Histórico aguardando sincronização; não reenvie.');
    }
    void queryClient.invalidateQueries({ queryKey: ['whatsapp_messages', scope.organizationId] });
  };
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={disabled || !member?.organization_id} aria-label="Mais tipos de mensagem" title="Localização e contato">
          <Plus className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setDialog('location')}><MapPin className="mr-2 h-4 w-4" />Enviar localização</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog('contact')}><Contact className="mr-2 h-4 w-4" />Enviar contato</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <SendLocationDialog open={dialog === 'location'} onOpenChange={open => { if (!open) setDialog(null); }} enviar={async location => {
      const scope = checkScope();
      const result = await sendLocation(instanceId, phoneNumber, location, leadId);
      await persist(scope, result, { kind: 'location', ...location });
    }} />
    <SendContactDialog open={dialog === 'contact'} onOpenChange={open => { if (!open) setDialog(null); }} enviar={async contacts => {
      const scope = checkScope();
      const result = await sendContact(instanceId, phoneNumber, contacts, leadId);
      const contact = contacts[0];
      await persist(scope, result, { kind: 'contact', name: contact.nome, phone: contact.telefones[0].numero, email: contact.emails?.[0] });
    }} />
  </>;
}
