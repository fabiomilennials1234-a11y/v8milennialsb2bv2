import type { GuidedConditionDraft } from '@/types/workflow';
import { summarizeGuidedCondition } from '../../lib/guided-condition-summary';

export type GuidedResultEntry = { id: string; status?: string; matched?: boolean; reference?: { id: string; name: string };
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
    const explained = current.field === 'lead.custom' && entry?.status === 'evaluated'
      && typeof entry.reference?.id === 'string' && typeof entry.reference.name === 'string'
      && entry.reference.id.toLowerCase() === current.fieldId.toLowerCase()
      ? { ...current, fieldLabel: entry.reference.name } : current.field === 'lead.tags' && entry?.status === 'evaluated'
      && typeof entry.reference?.id === 'string' && typeof entry.reference.name === 'string'
      && entry.reference.id.toLowerCase() === current.tagId.toLowerCase()
      ? { ...current, tagLabel: entry.reference.name } : current.field === 'lead.origin' && current.operator !== 'is_empty' && current.operator !== 'is_not_empty'
        && entry?.status === 'evaluated' && typeof entry.reference?.id === 'string' && typeof entry.reference.name === 'string'
        && entry.reference.id.toLowerCase() === current.originId.toLowerCase()
        ? { ...current, originLabel: entry.reference.name } : (current.field === 'lead.pre_sale_responsible_id' || current.field === 'lead.sale_responsible_id')
          && current.operator !== 'is_empty' && current.operator !== 'is_not_empty' && entry?.status === 'evaluated' && typeof entry.reference?.id === 'string' && typeof entry.reference.name === 'string'
          && entry.reference.id.toLowerCase() === current.memberId.toLowerCase()
          ? { ...current, memberLabel: entry.reference.name } : current.field === 'business.trigger.stage'
            && entry?.status === 'evaluated' && typeof entry.reference?.id === 'string' && typeof entry.reference.name === 'string'
            && entry.reference.id.toLowerCase() === current.stageId.toLowerCase()
            ? { ...current, stageLabel: entry.reference.name,
              pipelineLabel: entry.context?.pipeline?.id.toLowerCase() === current.pipelineId.toLowerCase()
                ? entry.context.pipeline.name : current.pipelineLabel } : current;
    return <p className="break-words">Condição {path} · {summarizeGuidedCondition(explained)}: {outcome}</p>;
  }
  return render(condition, '');
}
