import type { GuidedConditionDraft } from '@/types/workflow';
import { summarizeGuidedCondition } from '../../lib/guided-condition-summary';

export type GuidedResultEntry = { id: string; status?: string; matched?: boolean; actual?: unknown; reference?: { id: string; name: string } | {
  messageId: string; textSource: string | null; textProvider: string | null; textCreatedAt: string | null;
  provider: string; boxId: string; participantId: string };
  context?: { entryId?: string; pipeline?: { id: string; name: string } } };

export function GuidedConditionResult({ condition, rules, groups }: {
  condition: GuidedConditionDraft; rules: GuidedResultEntry[]; groups: GuidedResultEntry[];
}) {
  const entries = new Map([...rules, ...groups].map(entry => [entry.id, entry]));
  function render(current: GuidedConditionDraft, path: string): React.ReactNode {
    const entry = entries.get(current.id);
    const outcome = entry?.status === 'not_evaluated' ? 'Não avaliada'
      : typeof entry?.matched === 'boolean' ? entry.matched ? 'Sim' : 'Não' : 'Resultado indisponível';
    if ('kind' in current && current.kind === 'business_exists') {
      return <p className="break-words">Condição {path || 'principal'} · {summarizeGuidedCondition(current)}: {outcome}</p>;
    }
    if ('children' in current) {
      const label = path ? `Grupo ${path}` : 'Grupo principal';
      return <div role="group" aria-label={label} className="space-y-2 border-l-2 border-border pl-3">
        <p className="font-medium">{label} · {current.match === 'all' ? 'Todas' : 'Qualquer'}: {outcome}</p>
        <ul className="space-y-2">{current.children.map((child, index) => <li key={child.id}>{render(child, path ? `${path}.${index + 1}` : String(index + 1))}</li>)}</ul>
      </div>;
    }
    const namedReference = entry?.reference && 'name' in entry.reference ? entry.reference : undefined;
    const explained = current.field === 'lead.custom' && entry?.status === 'evaluated'
      && typeof namedReference?.id === 'string' && typeof namedReference.name === 'string'
      && namedReference.id.toLowerCase() === current.fieldId.toLowerCase()
      ? { ...current, fieldLabel: namedReference.name } : current.field === 'lead.tags' && entry?.status === 'evaluated'
      && typeof namedReference?.id === 'string' && typeof namedReference.name === 'string'
      && namedReference.id.toLowerCase() === current.tagId.toLowerCase()
      ? { ...current, tagLabel: namedReference.name } : current.field === 'lead.origin' && current.operator !== 'is_empty' && current.operator !== 'is_not_empty'
        && entry?.status === 'evaluated' && typeof namedReference?.id === 'string' && typeof namedReference.name === 'string'
        && namedReference.id.toLowerCase() === current.originId.toLowerCase()
        ? { ...current, originLabel: namedReference.name } : (current.field === 'lead.pre_sale_responsible_id' || current.field === 'lead.sale_responsible_id')
          && current.operator !== 'is_empty' && current.operator !== 'is_not_empty' && entry?.status === 'evaluated' && typeof namedReference?.id === 'string' && typeof namedReference.name === 'string'
          && namedReference.id.toLowerCase() === current.memberId.toLowerCase()
          ? { ...current, memberLabel: namedReference.name } : current.field === 'business.trigger.stage'
            && entry?.status === 'evaluated' && typeof namedReference?.id === 'string' && typeof namedReference.name === 'string'
            && namedReference.id.toLowerCase() === current.stageId.toLowerCase()
            ? { ...current, stageLabel: namedReference.name,
              pipelineLabel: entry.context?.pipeline?.id.toLowerCase() === current.pipelineId.toLowerCase()
                ? entry.context.pipeline.name : current.pipelineLabel } : current;
    const lastWonDetail = current.field === 'business.last_won_date' && entry?.status === 'evaluated'
      ? ` · ${namedReference?.name ?? 'Nenhuma venda ganha'} · ${typeof entry.actual === 'string' ? entry.actual.split('-').reverse().join('/') : 'Vazio'}` : '';
    const messageReference = current.field === 'message.trigger.text' && entry?.status === 'evaluated' && entry.reference && 'messageId' in entry.reference
      ? ` · Fonte: ${entry.reference.textSource === 'caption' ? 'legenda' : entry.reference.textSource === 'transcription' ? 'transcrição persistida' : entry.reference.textSource === 'interactive' ? 'resposta interativa' : entry.reference.textSource === 'synthetic' ? 'conteúdo estruturado' : 'texto'} · ${entry.reference.textProvider ?? entry.reference.provider}${entry.reference.textCreatedAt ? ` · ${new Date(entry.reference.textCreatedAt).toLocaleString('pt-BR')}` : ''}` : '';
    return <p className="break-words">Condição {path} · {summarizeGuidedCondition(explained)}: {outcome}{lastWonDetail}{messageReference}</p>;
  }
  return render(condition, '');
}
