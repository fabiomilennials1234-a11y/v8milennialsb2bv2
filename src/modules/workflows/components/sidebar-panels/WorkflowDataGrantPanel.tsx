import { GUIDED_SCALAR_FIELDS } from '@/contracts/workflows/guided-fields';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

interface WorkflowDataGrant { fields: string[]; revision: number }
// Additive preview schema; keep generated database types untouched. The local
// response contract is explicit until the canonical types are regenerated.
const database: SupabaseClient = supabase;

export function WorkflowDataGrantPanel({ actorId, workflowId, organizationId, canManage, requiredFields = ['lead.name'] }: {
  actorId: string; workflowId: string; organizationId: string; canManage: boolean; requiredFields?: Array<keyof typeof GUIDED_SCALAR_FIELDS | 'lead.tags' | 'lead.origin'>;
}) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const key = ['workflow-data-grant', actorId, organizationId, workflowId];
  const grant = useQuery({
    queryKey: key, enabled: canManage && Boolean(actorId && organizationId),
    queryFn: async ({ signal }) => {
      const response = await database.from('workflow_data_grants').select('fields, revision')
        .eq('organization_id', organizationId).eq('workflow_id', workflowId)
        .abortSignal(signal).returns<WorkflowDataGrant[]>().maybeSingle();
      if (response.error) throw response.error;
      return response.data;
    },
  });
  const authorized = requiredFields.length > 0 && requiredFields.every(field => grant.data?.fields.includes(field));
  const scopeLabel = requiredFields.map(field => field === 'lead.tags' ? 'Tags' : field === 'lead.origin' ? 'Origem' : GUIDED_SCALAR_FIELDS[field].label).join(' e ');
  const authorizeLabel = requiredFields.length === 1 && requiredFields[0] === 'lead.name' ? 'Autorizar acesso ao nome dos leads'
    : requiredFields.length === 1 && requiredFields[0] === 'lead.company' ? 'Autorizar acesso à empresa dos leads' : 'Autorizar acesso aos campos selecionados';
  async function update() {
    setPending(true);
    setError('');
    try {
      const response = await database.rpc('set_workflow_data_grant', {
        p_workflow_id: workflowId, p_fields: authorized
          ? (grant.data?.fields ?? []).filter(field => !requiredFields.includes(field as keyof typeof GUIDED_SCALAR_FIELDS))
          : [...new Set([...(grant.data?.fields ?? []), ...requiredFields])],
        p_expected_revision: grant.data?.revision ?? 0,
      });
      if (response.error) {
        setError(response.error.code === 'PT409'
          ? 'A autorização mudou. Confira o estado atualizado antes de tentar novamente.'
          : 'Não foi possível alterar a autorização. Verifique seu acesso.');
      }
      await client.invalidateQueries({ queryKey: key });
    } catch {
      setError('Autorização indisponível. Tente novamente.');
    } finally { setPending(false); }
  }
  return <section className="mt-6 space-y-3 rounded-xl border border-border p-4" aria-label="Acesso da automação">
    <h4 className="font-medium">Acesso da automação</h4>
    <p className="text-sm">{scopeLabel} de todos os leads desta organização</p>
    <p className="text-xs text-muted-foreground">Permite consultar esse dado durante a execução automática, mesmo se o criador sair da equipe. Seu teste continua usando suas permissões pessoais.</p>
    {!canManage ? <p className="text-sm text-muted-foreground">Um administrador precisa autorizar este acesso.</p> : <>
      {grant.isPending && <p className="text-sm text-muted-foreground">Consultando autorização…</p>}
      {grant.isError && <p role="alert" className="text-sm text-destructive">Não foi possível consultar a autorização.</p>}
      {grant.isSuccess && <>
        <p className="text-sm text-muted-foreground">{authorized ? 'Acesso autorizado pela organização' : 'Acesso ainda não autorizado'}</p>
        <Button type="button" variant={authorized ? 'outline' : 'default'} disabled={pending || grant.isFetching || requiredFields.length === 0} onClick={update}>
          {pending ? 'Atualizando…' : authorized ? 'Revogar acesso' : authorizeLabel}
        </Button>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </>}
  </section>;
}
