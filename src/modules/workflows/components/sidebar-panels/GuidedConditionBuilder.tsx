import { summarizeGuidedCondition } from '../../lib/guided-condition-summary';
import { useLayoutEffect, useRef, useState } from 'react';
import type { GuidedConditionDraft, GuidedRuleDraft } from '@/types/workflow';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function isIncompleteGuidedDraft(condition: GuidedConditionDraft): boolean {
  return 'children' in condition ? !condition.children.length || condition.children.some(isIncompleteGuidedDraft)
    : condition.operator === 'equals' && condition.value.length === 0;
}
const newRule = (): GuidedRuleDraft => ({ version: 1, id: crypto.randomUUID(), field: 'lead.name', operator: 'equals', value: '' });
function duplicateCondition(condition: GuidedConditionDraft): GuidedConditionDraft {
  return 'children' in condition
    ? { ...condition, id: crypto.randomUUID(), children: condition.children.map(duplicateCondition) }
    : { ...condition, id: crypto.randomUUID() };
}
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function GuidedConditionBuilder({ condition, onChange, groupDepth = 0 }: {
  condition: GuidedConditionDraft; groupDepth?: number; onChange: (condition: GuidedConditionDraft) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      document.getElementById(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  });
  const focusValue = (id: string) => { pendingFocus.current = `guided-value-${id}`; };
  if ('children' in condition) {
    return <fieldset className="space-y-4 rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-medium">Grupo de condições</legend>
      <Button type="button" variant="ghost" aria-expanded={!collapsed} aria-controls={`guided-content-${condition.id}`} onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Expandir grupo' : 'Recolher grupo'}</Button>
      {collapsed && <p className="break-words text-sm">{summarizeGuidedCondition(condition)}</p>}
      {!collapsed && <div id={`guided-content-${condition.id}`} className="space-y-4">
      <Label htmlFor={`guided-match-${condition.id}`}>Combinação</Label>
      <select id={`guided-match-${condition.id}`} className={selectClass} value={condition.match}
        onChange={event => onChange({ ...condition, match: event.target.value as 'all' | 'any' })}>
        <option value="all">Todas as condições (E)</option><option value="any">Qualquer condição (OU)</option>
      </select>
      {condition.children.length === 0 && <p className="text-sm text-destructive" role="alert">Grupo vazio. Adicione uma condição.</p>}
      {condition.children.map((child, index) => <div key={child.id} className="space-y-3 border-l-2 border-border pl-3">
        <p className="text-xs text-muted-foreground">Condição {index + 1}</p>
        <Button type="button" variant="ghost" onClick={() => {
          const copy = duplicateCondition(child);
          onChange({ ...condition, children: [...condition.children.slice(0, index + 1), copy, ...condition.children.slice(index + 1)] });
          pendingFocus.current = `guided-${'children' in copy ? 'match' : copy.operator === 'equals' ? 'value' : 'operator'}-${copy.id}`;
        }}>{'children' in child ? 'Duplicar grupo' : 'Duplicar regra'}</Button>
        <Button type="button" variant="ghost" onClick={() => {
          onChange({ ...condition, children: condition.children.filter(item => item.id !== child.id) });
          pendingFocus.current = `guided-match-${condition.id}`;
        }}>{'children' in child ? 'Excluir grupo' : 'Excluir regra'}</Button>
        <GuidedConditionBuilder condition={child} groupDepth={groupDepth + 1} onChange={replacement => onChange({ ...condition,
          children: condition.children.map(item => item.id === child.id ? replacement : item) })} />
      </div>)}
      <Button type="button" variant="outline" onClick={() => {
        const rule = newRule(); onChange({ ...condition, children: [...condition.children, rule] }); focusValue(rule.id);
      }}>Adicionar condição</Button>
      </div>}
    </fieldset>;
  }
  const missingValue = isIncompleteGuidedDraft(condition);
  return <div className="space-y-4">
    <div className="space-y-2"><Label htmlFor={`guided-field-${condition.id}`}>Informação</Label>
      <select id={`guided-field-${condition.id}`} className={selectClass} value="lead.name" disabled><option value="lead.name">Lead · Nome</option></select></div>
    <div className="space-y-2"><Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = { version: 1 as const, id: condition.id, field: 'lead.name' as const };
        onChange(event.target.value === 'is_empty' ? { ...base, operator: 'is_empty' } : { ...base, operator: 'equals', value: '' });
      }}><option value="equals">é igual a</option><option value="is_empty">está vazio</option></select></div>
    {condition.operator === 'equals' && <div className="space-y-2"><Label htmlFor={`guided-value-${condition.id}`}>Valor da comparação</Label>
      <Input id={`guided-value-${condition.id}`} value={condition.value} aria-invalid={missingValue}
        aria-describedby={missingValue ? `guided-value-error-${condition.id}` : undefined}
        onChange={event => onChange({ ...condition, value: event.target.value })} placeholder="Ex.: José" />
      {missingValue && <p id={`guided-value-error-${condition.id}`} className="text-xs text-destructive">Informe um valor ou escolha “está vazio”.</p>}
      <p className="text-xs text-muted-foreground">Maiúsculas e acentos não alteram a comparação.</p></div>}
    <Button type="button" variant="outline" disabled={groupDepth >= 3} title={groupDepth >= 3 ? "Limite de três níveis de grupos. Adicione regras ao grupo existente." : undefined} onClick={() => {
      const rule = newRule(); onChange({ version: 1, id: crypto.randomUUID(), kind: 'group', match: 'all', children: [condition, rule] }); focusValue(rule.id);
    }}>Adicionar condição</Button>
  </div>;
}
