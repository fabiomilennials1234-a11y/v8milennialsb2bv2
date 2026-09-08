import type { GuidedConditionDraft } from '@/types/workflow';
import { summarizeGuidedCondition } from '../../lib/guided-condition-summary';

export type GuidedResultEntry = { id: string; status?: string; matched?: boolean };

export function GuidedConditionResult({ condition, rules, groups }: {
  condition: GuidedConditionDraft; rules: GuidedResultEntry[]; groups: GuidedResultEntry[];
}) {
  const entries = new Map([...rules, ...groups].map(entry => [entry.id, entry]));
  function render(current: GuidedConditionDraft, path: string): React.ReactNode {
    const entry = entries.get(current.id);
    const outcome = entry?.status === 'not_evaluated' ? 'Não avaliada'
      : typeof entry?.matched === 'boolean' ? entry.matched ? 'Sim' : 'Não' : 'Resultado indisponível';
    if ('children' in current) {
      const label = path ? `Grupo ${path}` : 'Grupo principal';
      return <div role="group" aria-label={label} className="space-y-2 border-l-2 border-border pl-3">
        <p className="font-medium">{label} · {current.match === 'all' ? 'Todas' : 'Qualquer'}: {outcome}</p>
        <ul className="space-y-2">{current.children.map((child, index) => <li key={child.id}>{render(child, path ? `${path}.${index + 1}` : String(index + 1))}</li>)}</ul>
      </div>;
    }
    return <p className="break-words">Condição {path} · {summarizeGuidedCondition(current)}: {outcome}</p>;
  }
  return render(condition, '');
}
