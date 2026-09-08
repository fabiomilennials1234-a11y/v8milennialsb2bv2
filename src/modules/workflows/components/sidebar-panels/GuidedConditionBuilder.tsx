import { GUIDED_SCALAR_FIELDS, GUIDED_NUMBER_OPERATORS, isGuidedNumberField, isGuidedNumberOperator, GUIDED_TEXT_OPERATORS, isGuidedTextField, isGuidedTextOperator } from '@/contracts/workflows/guided-fields';
import { summarizeGuidedCondition } from '../../lib/guided-condition-summary';
import { useLayoutEffect, useRef, useState } from 'react';
import type { GuidedConditionDraft, GuidedRuleDraft } from '@/types/workflow';
import { GuidedUtmPicker } from './GuidedUtmPicker';
import { isUtmValueField } from '../../hooks/useOrgUtmValues';
import { GuidedTagPicker } from './GuidedTagPicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function isIncompleteGuidedDraft(condition: GuidedConditionDraft): boolean {
  return 'children' in condition ? !condition.children.length || condition.children.some(isIncompleteGuidedDraft)
    : condition.field === 'lead.tags' ? !condition.tagId : condition.operator !== 'is_empty' && (condition.value === '' || (typeof condition.value === 'number' && !Number.isFinite(condition.value)));
}
const newRule = (): GuidedRuleDraft => ({ version: 1, id: crypto.randomUUID(), field: 'lead.name', operator: 'equals', value: '' });
function duplicateCondition(condition: GuidedConditionDraft): GuidedConditionDraft {
  return 'children' in condition
    ? { ...condition, id: crypto.randomUUID(), children: condition.children.map(duplicateCondition) }
    : { ...condition, id: crypto.randomUUID() };
}
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function GuidedConditionBuilder({ condition, onChange, actorId, organizationId, groupDepth = 0 }: {
  actorId: string; organizationId: string; condition: GuidedConditionDraft; groupDepth?: number; onChange: (condition: GuidedConditionDraft) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [fieldReset, setFieldReset] = useState(false);
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
          pendingFocus.current = `guided-${'children' in copy ? 'match' : copy.operator !== 'is_empty' ? 'value' : 'operator'}-${copy.id}`;
        }}>{'children' in child ? 'Duplicar grupo' : 'Duplicar regra'}</Button>
        <Button type="button" variant="ghost" onClick={() => {
          onChange({ ...condition, children: condition.children.filter(item => item.id !== child.id) });
          pendingFocus.current = `guided-match-${condition.id}`;
        }}>{'children' in child ? 'Excluir grupo' : 'Excluir regra'}</Button>
        <GuidedConditionBuilder actorId={actorId} organizationId={organizationId} condition={child} groupDepth={groupDepth + 1} onChange={replacement => onChange({ ...condition,
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
      <select id={`guided-field-${condition.id}`} className={selectClass} value={condition.field} onChange={event => {
        setFieldReset(isGuidedTextField(condition.field) !== isGuidedTextField(event.target.value) || (condition.field === 'lead.qualification_score') !== isGuidedNumberField(event.target.value));
        if (event.target.value === 'lead.tags') onChange({ version: 1, id: condition.id, field: 'lead.tags', operator: 'has_tag', tagId: '' });
        else if (isGuidedNumberField(event.target.value)) onChange({ version: 1, id: condition.id, field: event.target.value, operator: 'equals', value: '' });
        else if (isGuidedTextField(event.target.value)) onChange(condition.field === 'lead.tags' || condition.field === 'lead.qualification_score'
          ? { version: 1, id: condition.id, field: event.target.value, operator: 'equals', value: '' }
          : { ...condition, field: event.target.value });
      }}>{Object.entries(GUIDED_SCALAR_FIELDS).map(([value, field]) => <option key={value} value={value}>Lead · {field.label}</option>)}<option value="lead.tags">Lead · Tags</option></select></div>
    {fieldReset && missingValue && <p className="text-xs text-muted-foreground" aria-live="polite">A informação mudou. Defina uma nova comparação.</p>}
    {condition.field === 'lead.tags' ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => onChange({ ...condition, operator: event.target.value === 'not_has_tag' ? 'not_has_tag' : 'has_tag' })}>
        <option value="has_tag">tem tag</option><option value="not_has_tag">não tem tag</option>
      </select>
      <GuidedTagPicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
    </> : condition.field === 'lead.qualification_score' ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = { version: 1 as const, id: condition.id, field: condition.field };
        const operator = event.target.value;
        if (operator === 'is_empty') onChange({ ...base, operator });
        else if (isGuidedNumberOperator(operator)) onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
      }}>{Object.entries(GUIDED_NUMBER_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="is_empty">está vazio</option></select>
      {condition.operator !== 'is_empty' && <div className="space-y-2">
        <Label htmlFor={`guided-value-${condition.id}`}>Valor da comparação</Label>
        <Input id={`guided-value-${condition.id}`} type="number" step="any" value={condition.value} aria-invalid={missingValue}
          onChange={event => onChange({ ...condition, value: event.target.value === '' ? '' : event.target.valueAsNumber })} />
        {missingValue && <p className="text-xs text-destructive">Informe um número ou escolha “está vazio”.</p>}
      </div>}
    </> : <>
    <div className="space-y-2"><Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = { version: 1 as const, id: condition.id, field: condition.field };
        const operator = event.target.value;
        if (operator === 'is_empty') onChange({ ...base, operator });
        else if (isGuidedTextOperator(operator)) onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
      }}>{Object.entries(GUIDED_TEXT_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="is_empty">está vazio</option></select></div>
    {condition.operator !== 'is_empty' && <div className="space-y-2"><Label htmlFor={`guided-value-${condition.id}`}>Valor da comparação</Label>
      {isUtmValueField(GUIDED_SCALAR_FIELDS[condition.field].column) ? <GuidedUtmPicker key={condition.field} id={`guided-value-${condition.id}`} actorId={actorId} organizationId={organizationId}
        field={GUIDED_SCALAR_FIELDS[condition.field].column} value={condition.value} onChange={value => onChange({ ...condition, value })} /> : <Input id={`guided-value-${condition.id}`} value={condition.value} aria-invalid={missingValue}
        aria-describedby={missingValue ? `guided-value-error-${condition.id}` : undefined}
        onChange={event => onChange({ ...condition, value: event.target.value })} placeholder="Ex.: José" />}
      {missingValue && <p id={`guided-value-error-${condition.id}`} className="text-xs text-destructive">Informe um valor ou escolha “está vazio”.</p>}
      <p className="text-xs text-muted-foreground">Maiúsculas e acentos não alteram a comparação.</p></div>}
    </>}
    <Button type="button" variant="outline" disabled={groupDepth >= 3} title={groupDepth >= 3 ? "Limite de três níveis de grupos. Adicione regras ao grupo existente." : undefined} onClick={() => {
      const rule = newRule(); onChange({ version: 1, id: crypto.randomUUID(), kind: 'group', match: 'all', children: [condition, rule] }); focusValue(rule.id);
    }}>Adicionar condição</Button>
  </div>;
}
