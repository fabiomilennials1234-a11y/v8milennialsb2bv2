import { GuidedCustomOptionPicker } from './GuidedCustomOptionPicker';
import { GUIDED_DATE_OPERATORS, isGuidedDateOperator } from '@/contracts/workflows/guided-dates';
import { GuidedFieldPicker, type GuidedFieldSelection } from './GuidedFieldPicker';
import { isGuidedResponsibleField, GUIDED_SCALAR_FIELDS, GUIDED_NUMBER_OPERATORS, isGuidedNumberField, isGuidedNumberOperator, GUIDED_TEXT_OPERATORS, isGuidedTextField, isGuidedTextOperator } from '@/contracts/workflows/guided-fields';
import { summarizeGuidedCondition } from '../../lib/guided-condition-summary';
import { useLayoutEffect, useRef, useState } from 'react';
import type { GuidedBusinessExistenceChildDraft, GuidedBusinessExistenceDraft, GuidedConditionDraft, GuidedRuleDraft } from '@/types/workflow';
import { GuidedLeadValuePicker } from './GuidedLeadValuePicker';
import { GuidedUtmPicker } from './GuidedUtmPicker';
import { isUtmValueField } from '../../hooks/useOrgUtmValues';
import { GuidedResponsiblePicker } from './GuidedResponsiblePicker';
import { GuidedOriginPicker } from './GuidedOriginPicker';
import { GuidedTagPicker } from './GuidedTagPicker';
import { GuidedBusinessStagePicker } from './GuidedBusinessStagePicker';
import { GuidedConversationPicker } from './GuidedConversationPicker';
import { GuidedProductPicker } from './GuidedProductPicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { GUIDED_CONDITION_LIMITS } from '@/contracts/workflows/guided-limits';
import { guidedDraftComplexity, isIncompleteGuidedDraft, normalizeGuidedExpressionKey } from '../../lib/guided-condition-draft';

const newRule = (): GuidedRuleDraft => ({ version: 1, id: crypto.randomUUID(), field: 'lead.name', operator: 'equals', value: '' });
function duplicateCondition(condition: GuidedConditionDraft): GuidedConditionDraft {
  return 'kind' in condition && condition.kind === 'business_exists'
    ? { ...condition, id: crypto.randomUUID(), children: condition.children.map(child => ({ ...child, id: crypto.randomUUID() })) }
    : 'children' in condition
    ? { ...condition, id: crypto.randomUUID(), children: condition.children.map(duplicateCondition) }
    : { ...condition, id: crypto.randomUUID() };
}
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const normalizeExpressionKey = normalizeGuidedExpressionKey;
function localDateTimeValue(value: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function defaultRule(id: string, field: Exclude<GuidedFieldSelection, 'business.exists'>): GuidedRuleDraft {
  if (field === 'business.trigger.stage') return { version: 1, id, field, operator: 'equals', pipelineId: '', stageId: '' };
  if (field === 'business.trigger.stage_elapsed') return { version: 1, id, field, operator: 'greater_than_or_equal', value: '', unit: 'hours' };
  if (field === 'business.last_won_date') return { version: 1, id, field, operator: 'equals', value: '' };
  if (field === 'message.trigger.text') return { version: 1, id, field, conversation: { kind: 'trigger' }, operator: 'contains', value: '' };
  if (field === 'message.period.exists') return { version: 1, id, field, conversation: { kind: 'trigger' }, operator: 'exists', from: '', to: '' };
  if (field === 'message.search.text') return { version: 1, id, field, conversation: { kind: 'trigger' }, source: { kind: 'trigger' },
    operator: 'matches', expressionMatch: 'any', matchMode: 'whole_phrase', expressions: [] };
  if (field === 'message.waiting.elapsed') return { version: 1, id, field, conversation: { kind: 'trigger' }, waitingFor: 'company',
    operator: 'greater_than_or_equal', value: '', unit: 'hours' };
  if (field === 'activity.follow_up') return { version: 1, id, field, relation: 'lead', state: 'pending',
    operator: 'exists', dateOperator: 'any' };
  if (field === 'product.relationship') return { version: 1, id, field, relation: 'trigger_business_item',
    productId: '', operator: 'has_product' };
  if (field === 'business.trigger.value' || isGuidedNumberField(field)) return { version: 1, id, field, operator: 'equals', value: '' };
  if (isGuidedResponsibleField(field)) return { version: 1, id, field, operator: 'equals', memberId: '' };
  if (field === 'lead.origin') return { version: 1, id, field, operator: 'equals', originId: '' };
  if (field === 'lead.tags') return { version: 1, id, field, operator: 'has_tag', tagId: '' };
  return { version: 1, id, field, operator: 'equals', value: '' };
}

function defaultCustomRule(id: string, fieldId: string, fieldLabel: string, fieldType: 'text' | 'number' | 'boolean' | 'date' | 'select'): GuidedRuleDraft {
  if (fieldType === 'number') return { version: 1, id, field: 'lead.custom', fieldId, fieldLabel, fieldType, operator: 'equals', value: '' };
  if (fieldType === 'boolean') return { version: 1, id, field: 'lead.custom', fieldId, fieldLabel, fieldType, operator: 'equals', value: '' };
  if (fieldType === 'date') return { version: 1, id, field: 'lead.custom', fieldId, fieldLabel, fieldType, operator: 'equals', value: '' };
  if (fieldType === 'select') return { version: 1, id, field: 'lead.custom', fieldId, fieldLabel, fieldType, operator: 'equals', value: '' };
  return { version: 1, id, field: 'lead.custom', fieldId, fieldLabel, fieldType, operator: 'equals', value: '' };
}

function GuidedBusinessExistenceBuilder({ condition, onChange, actorId, organizationId, totalComplexity }: {
  condition: GuidedBusinessExistenceDraft; onChange: (condition: GuidedConditionDraft) => void; actorId: string; organizationId: string;
  totalComplexity: number;
}) {
  const updateChild = (id: string, replacement: GuidedBusinessExistenceChildDraft) => onChange({ ...condition,
    children: condition.children.map(child => child.id === id ? replacement : child) });
  return <fieldset className="space-y-4 rounded-xl border border-border p-3">
    <legend className="px-1 text-sm font-medium">Existe negócio</legend>
    <div className="space-y-2"><Label htmlFor={`guided-field-${condition.id}`}>Informação</Label>
      <GuidedFieldPicker id={`guided-field-${condition.id}`} value="business.exists" actorId={actorId} organizationId={organizationId}
        onChange={field => field !== 'business.exists' && onChange(defaultRule(condition.id, field))}
        onCustomSelect={(fieldId, fieldLabel, fieldType) => onChange(defaultCustomRule(condition.id, fieldId, fieldLabel, fieldType))} />
    </div>
    <div className="space-y-2"><Label htmlFor={`guided-lifecycle-${condition.id}`}>Ciclo do negócio</Label>
      <select id={`guided-lifecycle-${condition.id}`} className={selectClass} value={condition.lifecycle}
        onChange={event => onChange({ ...condition, lifecycle: event.target.value as GuidedBusinessExistenceDraft['lifecycle'] })}>
        <option value="open">Em aberto</option><option value="won">Ganho</option><option value="lost">Perdido</option><option value="all">Todos</option>
      </select>
      <p className="text-xs text-muted-foreground">Escolha quais negócios entram na busca.</p>
    </div>
    <div className="space-y-2"><Label htmlFor={`guided-exists-match-${condition.id}`}>Combinação no mesmo negócio</Label>
      <select id={`guided-exists-match-${condition.id}`} className={selectClass} value={condition.match}
        onChange={event => onChange({ ...condition, match: event.target.value === 'any' ? 'any' : 'all' })}>
        <option value="all">Todos os filtros (E)</option><option value="any">Qualquer filtro (OU)</option>
      </select>
      <p className="text-xs text-muted-foreground">Os filtros são avaliados juntos em cada negócio. Dados de negócios diferentes nunca são combinados.</p>
    </div>
    {condition.children.map((child, index) => <div key={child.id} className="space-y-3 border-l-2 border-border pl-3">
      <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Filtro {index + 1}</p>
        {condition.children.length > 1 && <Button type="button" variant="ghost" onClick={() => onChange({ ...condition,
          children: condition.children.filter(item => item.id !== child.id) })}>Excluir filtro</Button>}
      </div>
      <div className="space-y-2"><Label htmlFor={`guided-business-field-${child.id}`}>Informação do negócio {index + 1}</Label>
        <select id={`guided-business-field-${child.id}`} className={selectClass} value={child.field} onChange={event => updateChild(child.id,
          event.target.value === 'business.value' ? { version: 1, id: child.id, field: 'business.value', operator: 'equals', value: '' }
            : { version: 1, id: child.id, field: 'business.stage', operator: 'equals', pipelineId: '', stageId: '' })}>
          <option value="business.stage">Etapa</option><option value="business.value">Valor</option>
        </select>
      </div>
      {child.field === 'business.stage' ? <>
        <Label htmlFor={`guided-business-operator-${child.id}`}>Comparação do negócio {index + 1}</Label>
        <select id={`guided-business-operator-${child.id}`} className={selectClass} value={child.operator}
          onChange={event => updateChild(child.id, { ...child, operator: event.target.value === 'not_equals' ? 'not_equals' : 'equals' })}>
          <option value="equals">é</option><option value="not_equals">não é</option>
        </select>
        <GuidedBusinessStagePicker actorId={actorId} organizationId={organizationId} condition={child} onChange={replacement => updateChild(child.id, replacement)} />
      </> : <>
        <Label htmlFor={`guided-business-operator-${child.id}`}>Comparação do negócio {index + 1}</Label>
        <select id={`guided-business-operator-${child.id}`} className={selectClass} value={child.operator} onChange={event => {
          const operator = event.target.value;
          if (operator === 'is_empty' || operator === 'is_not_empty') updateChild(child.id, { version: 1, id: child.id, field: 'business.value', operator });
          else if (isGuidedNumberOperator(operator)) updateChild(child.id, { version: 1, id: child.id, field: 'business.value', operator,
            value: 'value' in child ? child.value : '' });
        }}>
          {Object.entries(GUIDED_NUMBER_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="is_empty">está vazio</option><option value="is_not_empty">está preenchido</option>
        </select>
        {child.operator !== 'is_empty' && child.operator !== 'is_not_empty' && <div className="space-y-2">
          <Label htmlFor={`guided-business-value-${child.id}`}>Valor do negócio {index + 1}</Label>
          <Input id={`guided-business-value-${child.id}`} type="number" step="any" value={child.value}
            onChange={event => updateChild(child.id, { ...child, value: event.target.value === '' ? '' : event.target.valueAsNumber })} />
        </div>}
      </>}
    </div>)}
    <Button type="button" variant="outline" disabled={totalComplexity >= GUIDED_CONDITION_LIMITS.maxComplexity} onClick={() => {
      const id = crypto.randomUUID();
      const child: GuidedBusinessExistenceChildDraft = condition.children.some(item => item.field === 'business.stage')
        ? { version: 1, id, field: 'business.value', operator: 'equals', value: '' }
        : { version: 1, id, field: 'business.stage', operator: 'equals', pipelineId: '', stageId: '' };
      onChange({ ...condition, children: [...condition.children, child] });
    }}>Adicionar filtro do negócio</Button>
  </fieldset>;
}

export function GuidedConditionBuilder({ condition, onChange, actorId, organizationId, groupDepth = 0, totalComplexity }: {
  actorId: string; organizationId: string; condition: GuidedConditionDraft; groupDepth?: number; totalComplexity?: number;
  onChange: (condition: GuidedConditionDraft) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [fieldReset, setFieldReset] = useState(false);
  const [expressionInput, setExpressionInput] = useState('');
  const treeComplexity = totalComplexity ?? guidedDraftComplexity(condition);
  const atComplexityLimit = treeComplexity >= GUIDED_CONDITION_LIMITS.maxComplexity;
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      document.getElementById(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  });
  const focusValue = (id: string) => { pendingFocus.current = `guided-value-${id}`; };
  if ('kind' in condition && condition.kind === 'business_exists') {
    return <GuidedBusinessExistenceBuilder actorId={actorId} organizationId={organizationId} condition={condition}
      totalComplexity={treeComplexity} onChange={onChange} />;
  }
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
        <Button type="button" variant="ghost" disabled={treeComplexity + guidedDraftComplexity(child) > GUIDED_CONDITION_LIMITS.maxComplexity} onClick={() => {
          const copy = duplicateCondition(child);
          onChange({ ...condition, children: [...condition.children.slice(0, index + 1), copy, ...condition.children.slice(index + 1)] });
          pendingFocus.current = `guided-${'children' in copy ? 'match' : copy.operator !== 'is_empty' && copy.operator !== 'is_not_empty' ? 'value' : 'operator'}-${copy.id}`;
        }}>{'children' in child ? 'Duplicar grupo' : 'Duplicar regra'}</Button>
        <Button type="button" variant="ghost" onClick={() => {
          onChange({ ...condition, children: condition.children.filter(item => item.id !== child.id) });
          pendingFocus.current = `guided-match-${condition.id}`;
        }}>{'children' in child ? 'Excluir grupo' : 'Excluir regra'}</Button>
        <GuidedConditionBuilder actorId={actorId} organizationId={organizationId} condition={child} groupDepth={groupDepth + 1}
          totalComplexity={treeComplexity} onChange={replacement => onChange({ ...condition,
          children: condition.children.map(item => item.id === child.id ? replacement : item) })} />
      </div>)}
      <Button type="button" variant="outline" disabled={atComplexityLimit} onClick={() => {
        const rule = newRule(); onChange({ ...condition, children: [...condition.children, rule] }); focusValue(rule.id);
      }}>Adicionar condição</Button>
      {atComplexityLimit && <p className="text-xs text-muted-foreground">Limite de {GUIDED_CONDITION_LIMITS.maxComplexity} itens por condição.</p>}
      </div>}
    </fieldset>;
  }
  const missingValue = isIncompleteGuidedDraft(condition);
  return <div className="space-y-4">
    <div className="space-y-2"><Label htmlFor={`guided-field-${condition.id}`}>Informação</Label>
      <GuidedFieldPicker id={`guided-field-${condition.id}`} value={condition.field} actorId={actorId} organizationId={organizationId}
        custom={condition.field === 'lead.custom' ? condition : undefined}
        onCustomSelect={(fieldId, fieldLabel, fieldType) => {
          if (fieldType === 'select') {
            const base = { version: 1 as const, id: condition.id, field: 'lead.custom' as const, fieldId, fieldType, fieldLabel };
            const sameField = condition.field === 'lead.custom' && condition.fieldType === 'select' && condition.fieldId === fieldId;
            setFieldReset(!sameField);
            if (sameField && condition.operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
            else if (sameField && condition.operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
            else if (sameField && (condition.operator === 'equals' || condition.operator === 'not_equals') && 'value' in condition) onChange({ ...base, operator: condition.operator, value: condition.value });
            else onChange({ ...base, operator: 'equals', value: '' });
            return;
          }
          if (fieldType === 'date') {
            const base = { version: 1 as const, id: condition.id, field: 'lead.custom' as const, fieldId, fieldType, fieldLabel };
            const compatible = condition.field === 'business.last_won_date' || (condition.field === 'lead.custom' && condition.fieldType === 'date');
            setFieldReset(!compatible);
            if (compatible && condition.operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
            else if (compatible && condition.operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
            else if (compatible && isGuidedDateOperator(condition.operator) && 'value' in condition) onChange({ ...base, operator: condition.operator, value: condition.value });
            else onChange({ ...base, operator: 'equals', value: '' });
            return;
          }
          if (fieldType === 'boolean') {
            const base = { version: 1 as const, id: condition.id, field: 'lead.custom' as const, fieldId, fieldType, fieldLabel };
            const compatible = condition.field === 'lead.custom' && condition.fieldType === 'boolean';
            setFieldReset(!compatible);
            if (compatible) onChange(condition.operator === 'is_empty' || condition.operator === 'is_not_empty'
              ? { ...base, operator: condition.operator } : { ...base, operator: condition.operator, value: condition.value });
            else onChange({ ...base, operator: 'equals', value: '' });
            return;
          }
          if (fieldType === 'number') {
            const compatible = condition.field === 'business.trigger.stage_elapsed' || condition.field === 'business.trigger.value'
              || condition.field === 'lead.qualification_score' || (condition.field === 'lead.custom' && condition.fieldType === 'number');
            setFieldReset(!compatible);
            const base = { version: 1 as const, id: condition.id, field: 'lead.custom' as const, fieldId, fieldType, fieldLabel };
            if (compatible && (condition.operator === 'is_empty' || condition.operator === 'is_not_empty')) onChange({ ...base, operator: condition.operator });
            else if (compatible && isGuidedNumberOperator(condition.operator) && 'value' in condition && (typeof condition.value === 'number' || condition.value === '')) onChange({ ...base, operator: condition.operator, value: condition.value });
            else onChange({ ...base, operator: 'equals', value: '' });
            return;
          }
          const compatible = isGuidedTextField(condition.field) || (condition.field === 'lead.custom' && condition.fieldType === 'text');
          setFieldReset(!compatible);
          const base = { version: 1 as const, id: condition.id, field: 'lead.custom' as const, fieldId, fieldType: 'text' as const, fieldLabel };
          if (compatible && condition.operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
          else if (compatible && condition.operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
          else if (compatible && isGuidedTextOperator(condition.operator) && 'value' in condition && typeof condition.value === 'string') {
            onChange({ ...base, operator: condition.operator, value: condition.value });
          } else onChange({ ...base, operator: 'equals', value: '' });

        }} onChange={field => {
        if (field === 'business.exists') {
          onChange({ version: 1, id: condition.id, kind: 'business_exists', lifecycle: 'open', match: 'all', children: [
            { version: 1, id: crypto.randomUUID(), field: 'business.stage', operator: 'equals', pipelineId: '', stageId: '' },
          ] });
          return;
        }
        setFieldReset(condition.field !== field && !(((isGuidedTextField(condition.field) || (condition.field === 'lead.custom' && condition.fieldType === 'text')) && isGuidedTextField(field)) || (isGuidedResponsibleField(condition.field) && isGuidedResponsibleField(field))));
        if (field === 'business.trigger.stage') onChange(condition.field === field ? condition
          : { version: 1, id: condition.id, field, operator: 'equals', pipelineId: '', stageId: '' });
        else if (field === 'business.trigger.stage_elapsed') {
          if (condition.field === 'business.trigger.stage_elapsed') onChange(condition);
          else if ((condition.field === 'business.trigger.value' || condition.field === 'lead.qualification_score'
            || (condition.field === 'lead.custom' && condition.fieldType === 'number'))
            && isGuidedNumberOperator(condition.operator) && 'value' in condition) {
            onChange({ version: 1, id: condition.id, field, operator: condition.operator, value: condition.value, unit: 'hours' });
          } else onChange({ version: 1, id: condition.id, field, operator: 'greater_than_or_equal', value: '', unit: 'hours' });
        }
        else if (field === 'business.trigger.value') {
          const base = { version: 1 as const, id: condition.id, field };
          if ((condition.field === 'business.trigger.value' || condition.field === 'lead.qualification_score'
            || (condition.field === 'lead.custom' && condition.fieldType === 'number')) && condition.operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
          else if ((condition.field === 'business.trigger.value' || condition.field === 'lead.qualification_score'
            || (condition.field === 'lead.custom' && condition.fieldType === 'number')) && condition.operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
          else if ((condition.field === 'business.trigger.stage_elapsed' || condition.field === 'business.trigger.value' || condition.field === 'lead.qualification_score'
            || (condition.field === 'lead.custom' && condition.fieldType === 'number')) && isGuidedNumberOperator(condition.operator)
            && 'value' in condition) onChange({ ...base, operator: condition.operator, value: condition.value });
          else onChange({ ...base, operator: 'equals', value: '' });
        }
        else if (field === 'business.last_won_date') {
          const base = { version: 1 as const, id: condition.id, field };
          const compatible = condition.field === 'business.last_won_date' || (condition.field === 'lead.custom' && condition.fieldType === 'date');
          if (compatible && condition.operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
          else if (compatible && condition.operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
          else if (compatible && isGuidedDateOperator(condition.operator) && 'value' in condition) onChange({ ...base, operator: condition.operator, value: condition.value });
          else onChange({ ...base, operator: 'equals', value: '' });
        }
        else if (field === 'message.trigger.text') onChange(condition.field === field ? condition
          : { version: 1, id: condition.id, field, conversation: { kind: 'trigger' }, operator: 'contains', value: '' });
        else if (field === 'message.period.exists') onChange(condition.field === field ? condition
          : { version: 1, id: condition.id, field, conversation: { kind: 'trigger' }, operator: 'exists', from: '', to: '' });
        else if (field === 'message.search.text') onChange(condition.field === field ? condition
          : { version: 1, id: condition.id, field, conversation: { kind: 'trigger' }, source: { kind: 'trigger' }, operator: 'matches',
            expressionMatch: 'any', matchMode: 'whole_phrase', expressions: [] });
        else if (field === 'message.waiting.elapsed') onChange(condition.field === field ? condition
          : { version: 1, id: condition.id, field, conversation: { kind: 'trigger' }, waitingFor: 'company',
            operator: 'greater_than_or_equal', value: '', unit: 'hours' });
        else if (field === 'activity.follow_up') onChange(condition.field === field ? condition
          : { version: 1, id: condition.id, field, relation: 'lead', state: 'pending', operator: 'exists', dateOperator: 'any' });
        else if (field === 'product.relationship') onChange(condition.field === field ? condition
          : { version: 1, id: condition.id, field, relation: 'trigger_business_item', productId: '', operator: 'has_product' });
        else if (isGuidedResponsibleField(field)) onChange((condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id')
          ? { ...condition, field } : { version: 1, id: condition.id, field, operator: 'equals', memberId: '' });
        else if (field === 'lead.origin') onChange({ version: 1, id: condition.id, field: 'lead.origin', operator: 'equals', originId: '' });
        else if (field === 'lead.tags') onChange({ version: 1, id: condition.id, field: 'lead.tags', operator: 'has_tag', tagId: '' });
        else if (isGuidedNumberField(field)) {
          const base = { version: 1 as const, id: condition.id, field };
          if (condition.field === 'business.trigger.stage_elapsed' || condition.field === 'lead.qualification_score' || (condition.field === 'lead.custom' && condition.fieldType === 'number')) {
            onChange(condition.operator === 'is_empty' || condition.operator === 'is_not_empty'
              ? { ...base, operator: condition.operator } : { ...base, operator: condition.operator, value: condition.value });
          } else onChange({ ...base, operator: 'equals', value: '' });
        }
        else if (isGuidedTextField(field)) onChange(condition.field === 'business.trigger.stage' || condition.field === 'business.trigger.value' || condition.field === 'business.trigger.stage_elapsed' || condition.field === 'business.last_won_date' || condition.field === 'message.period.exists' || condition.field === 'message.search.text' || condition.field === 'message.waiting.elapsed' || condition.field === 'activity.follow_up' || condition.field === 'product.relationship' || condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id' || condition.field === 'lead.origin' || condition.field === 'lead.tags' || condition.field === 'lead.qualification_score' || (condition.field === 'lead.custom' && condition.fieldType !== 'text')
          ? { version: 1, id: condition.id, field, operator: 'equals', value: '' }
          : { version: 1, id: condition.id, field, ...(condition.operator === 'is_empty' || condition.operator === 'is_not_empty' ? { operator: condition.operator } : { operator: condition.operator, value: condition.value }) });
      }} /></div>
    {fieldReset && missingValue && <p className="text-xs text-muted-foreground" aria-live="polite">A informação mudou. Defina uma nova comparação.</p>}
    {condition.field === 'product.relationship' ? <>
      <Label htmlFor={`guided-product-relation-${condition.id}`}>Relação consultada</Label>
      <select id={`guided-product-relation-${condition.id}`} className={selectClass} value={condition.relation}
        onChange={event => onChange({ ...condition, relation: event.target.value === 'lead_association' ? 'lead_association'
          : event.target.value === 'won_deal_history' ? 'won_deal_history' : 'trigger_business_item' })}>
        <option value="trigger_business_item">Item do negócio do gatilho</option>
        <option value="lead_association">Associação manual ativa do lead</option>
        <option value="won_deal_history">Registro de negócio ganho</option>
      </select>
      <p className="text-xs text-muted-foreground">Cada opção consulta uma relação diferente. Negócio ganho registra venda comercial; não confirma pagamento.</p>
      <Label htmlFor={`guided-product-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-product-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => onChange({ ...condition, operator: event.target.value === 'not_has_product' ? 'not_has_product' : 'has_product' })}>
        <option value="has_product">tem o produto</option><option value="not_has_product">não tem o produto</option>
      </select>
      <GuidedProductPicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
      <p className="text-xs text-muted-foreground">Itens avulsos não usam cadastro e não são comparados por nome.</p>
    </> : condition.field === 'activity.follow_up' ? <>
      <Label htmlFor={`guided-follow-up-relation-${condition.id}`}>Vínculo</Label>
      <select id={`guided-follow-up-relation-${condition.id}`} className={selectClass} value={condition.relation}
        onChange={event => onChange({ ...condition, relation: event.target.value === 'trigger_business' ? 'trigger_business' : 'lead' })}>
        <option value="lead">Do lead, sem negócio</option><option value="trigger_business">Do negócio do gatilho</option>
      </select>
      <p className="text-xs text-muted-foreground">Follow-ups de outros negócios nunca entram. O vínculo “lead” considera somente tarefas sem negócio.</p>
      <Label htmlFor={`guided-follow-up-state-${condition.id}`}>Estado</Label>
      <select id={`guided-follow-up-state-${condition.id}`} className={selectClass} value={condition.state}
        onChange={event => onChange({ ...condition, state: event.target.value === 'completed' ? 'completed' : 'pending' })}>
        <option value="pending">Pendente e ativo</option><option value="completed">Concluído</option>
      </select>
      <Label htmlFor={`guided-follow-up-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-follow-up-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => onChange({ ...condition, operator: event.target.value === 'not_exists' ? 'not_exists' : 'exists' })}>
        <option value="exists">existe follow-up</option><option value="not_exists">não existe follow-up</option>
      </select>
      <Label htmlFor={`guided-follow-up-date-operator-${condition.id}`}>{condition.state === 'pending' ? 'Prazo' : 'Data de conclusão'}</Label>
      <select id={`guided-follow-up-date-operator-${condition.id}`} className={selectClass} value={condition.dateOperator}
        onChange={event => onChange({ ...condition, dateOperator: event.target.value === 'any' ? 'any'
          : isGuidedDateOperator(event.target.value) ? event.target.value : 'any',
          ...(event.target.value === 'any' ? { date: undefined } : { date: condition.date ?? '' }) })}>
        <option value="any">qualquer data</option>
        {Object.entries(GUIDED_DATE_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {condition.dateOperator !== 'any' && <div className="space-y-2">
        <Label htmlFor={`guided-value-${condition.id}`}>Data</Label>
        <Input id={`guided-value-${condition.id}`} type="date" min="0001-01-01" max="9999-12-31" value={condition.date ?? ''}
          aria-invalid={missingValue} onChange={event => onChange({ ...condition, date: event.target.value })} />
        {missingValue && <p className="text-xs text-destructive">Escolha uma data válida.</p>}
      </div>}
      <p className="text-xs text-muted-foreground">Pendente usa o prazo. Concluído usa o instante real de conclusão. Criação não conta como contato.</p>
    </> : condition.field === 'message.waiting.elapsed' ? <>
      <GuidedConversationPicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
      <Label htmlFor={`guided-waiting-side-${condition.id}`}>Quem está aguardando</Label>
      <select id={`guided-waiting-side-${condition.id}`} className={selectClass} value={condition.waitingFor}
        onChange={event => onChange({ ...condition, waitingFor: event.target.value === 'lead' ? 'lead' : 'company' })}>
        <option value="company">Empresa aguardando resposta do lead</option><option value="lead">Lead aguardando resposta</option>
      </select>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => isGuidedNumberOperator(event.target.value) && onChange({ ...condition, operator: event.target.value })}>
        {Object.entries(GUIDED_NUMBER_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2"><Label htmlFor={`guided-value-${condition.id}`}>Tempo</Label><Input id={`guided-value-${condition.id}`}
          type="number" min="0" step="any" value={condition.value} aria-invalid={missingValue}
          onChange={event => onChange({ ...condition, value: event.target.value === '' ? '' : event.target.valueAsNumber })} /></div>
        <div className="space-y-2"><Label htmlFor={`guided-unit-${condition.id}`}>Unidade</Label><select id={`guided-unit-${condition.id}`}
          className={selectClass} value={condition.unit} onChange={event => onChange({ ...condition,
            unit: event.target.value === 'minutes' ? 'minutes' : event.target.value === 'days' ? 'days' : 'hours' })}>
          <option value="minutes">minutos</option><option value="hours">horas</option><option value="days">dias</option>
        </select></div>
      </div>
      <p className="text-xs text-muted-foreground">Conta desde a primeira mensagem ainda sem resposta. Complementos do mesmo lado não reiniciam o relógio.</p>
      {missingValue && <p className="text-xs text-destructive">Informe um tempo maior ou igual a zero.</p>}
    </> : condition.field === 'message.search.text' ? <>
      <GuidedConversationPicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange}
        triggerOnly={condition.source.kind === 'trigger'} />
      <Label htmlFor={`guided-message-source-${condition.id}`}>Origem da mensagem</Label>
      <select id={`guided-message-source-${condition.id}`} className={selectClass} value={condition.source.kind} onChange={event => {
        const kind = event.target.value;
        if (kind === 'trigger') onChange({ ...condition, conversation: { kind: 'trigger' }, source: { kind: 'trigger' } });
        else if (kind === 'period') onChange({ ...condition, source: condition.source.kind === 'period' ? condition.source : { kind: 'period', from: '', to: '' } });
        else onChange({ ...condition, source: { kind: 'last_received' } });
      }}>
        <option value="trigger">Mensagem do gatilho</option>
        <option value="last_received">Última mensagem recebida</option>
        <option value="period">Mensagens recebidas no período</option>
      </select>
      {condition.source.kind === 'period' && <>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label htmlFor={`guided-search-from-${condition.id}`}>De</Label><Input id={`guided-search-from-${condition.id}`} type="datetime-local"
            value={localDateTimeValue(condition.source.from)} onChange={event => onChange({ ...condition, source: { kind: 'period',
              from: event.target.value ? new Date(event.target.value).toISOString() : '', to: condition.source.kind === 'period' ? condition.source.to : '' } })} /></div>
          <div className="space-y-2"><Label htmlFor={`guided-search-to-${condition.id}`}>Até</Label><Input id={`guided-search-to-${condition.id}`} type="datetime-local"
            value={localDateTimeValue(condition.source.to)} onChange={event => onChange({ ...condition, source: { kind: 'period',
              from: condition.source.kind === 'period' ? condition.source.from : '', to: event.target.value ? new Date(event.target.value).toISOString() : '' } })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Inclui o início e exclui o instante final. Uma resposta negativa exige histórico completo.</p>
      </>}
      <Label htmlFor={`guided-search-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-search-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => onChange({ ...condition, operator: event.target.value === 'not_matches' ? 'not_matches' : 'matches' })}>
        <option value="matches">contém as expressões</option><option value="not_matches">não contém as expressões</option>
      </select>
      <Label htmlFor={`guided-search-combination-${condition.id}`}>Combinação</Label>
      <select id={`guided-search-combination-${condition.id}`} className={selectClass} value={condition.expressionMatch}
        onChange={event => onChange({ ...condition, expressionMatch: event.target.value === 'all' ? 'all' : 'any' })}>
        <option value="any">qualquer expressão (OU)</option><option value="all">todas na mesma mensagem (E)</option>
      </select>
      <Label htmlFor={`guided-search-mode-${condition.id}`}>Modo de correspondência</Label>
      <select id={`guided-search-mode-${condition.id}`} className={selectClass} value={condition.matchMode}
        onChange={event => onChange({ ...condition, matchMode: event.target.value === 'substring' ? 'substring' : 'whole_phrase' })}>
        <option value="whole_phrase">palavra ou expressão inteira</option><option value="substring">trecho do texto</option>
      </select>
      <form className="space-y-2" onSubmit={event => {
        event.preventDefault();
        const expression = expressionInput.trim();
        const key = normalizeExpressionKey(expression);
        if (!key || expression.length > 120 || condition.expressions.length >= 20
          || condition.expressions.some(item => normalizeExpressionKey(item) === key)) return;
        onChange({ ...condition, expressions: [...condition.expressions, expression] });
        setExpressionInput('');
      }}>
        <Label htmlFor={`guided-search-expression-${condition.id}`}>Palavra ou expressão</Label>
        <div className="flex gap-2"><Input id={`guided-search-expression-${condition.id}`} value={expressionInput} maxLength={120}
          onChange={event => setExpressionInput(event.target.value)} placeholder="Ex.: preço final" />
          <Button type="submit" variant="outline" disabled={!normalizeExpressionKey(expressionInput) || expressionInput.trim().length > 120
            || condition.expressions.length >= 20 || condition.expressions.some(item => normalizeExpressionKey(item) === normalizeExpressionKey(expressionInput))}>Adicionar</Button>
        </div>
        <p className="text-xs text-muted-foreground">Pressione Enter para adicionar. Acentos, caixa, pontuação e espaços não mudam a busca.</p>
      </form>
      {condition.expressions.length > 0 && <ul aria-label="Expressões configuradas" className="flex flex-wrap gap-2">
        {condition.expressions.map(expression => <li key={normalizeExpressionKey(expression)} className="flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-sm">
          <span>{expression}</span><Button type="button" variant="ghost" className="h-6 px-1" aria-label={`Remover ${expression}`}
            onClick={() => onChange({ ...condition, expressions: condition.expressions.filter(item => item !== expression) })}>×</Button>
        </li>)}
      </ul>}
      {missingValue && <p className="text-xs text-destructive">Adicione de 1 a 20 expressões únicas e complete conversa e período quando exigidos.</p>}
    </> : condition.field === 'message.period.exists' ? <>
      <GuidedConversationPicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => onChange({ ...condition, operator: event.target.value === 'not_exists' ? 'not_exists' : 'exists' })}>
        <option value="exists">existe mensagem recebida</option><option value="not_exists">não existe mensagem recebida</option>
      </select>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2"><Label htmlFor={`guided-from-${condition.id}`}>De</Label><Input id={`guided-from-${condition.id}`} type="datetime-local"
          value={localDateTimeValue(condition.from)} onChange={event => onChange({ ...condition, from: event.target.value ? new Date(event.target.value).toISOString() : '' })} /></div>
        <div className="space-y-2"><Label htmlFor={`guided-to-${condition.id}`}>Até</Label><Input id={`guided-to-${condition.id}`} type="datetime-local"
          value={localDateTimeValue(condition.to)} onChange={event => onChange({ ...condition, to: event.target.value ? new Date(event.target.value).toISOString() : '' })} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Inclui o início e exclui o instante final. Ausência só é concluída quando o histórico cobre todo o período.</p>
      {missingValue && <p className="text-xs text-destructive">Informe um período válido de até 366 dias.</p>}
    </> : condition.field === 'message.trigger.text' ? <>
      <GuidedConversationPicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const operator = event.target.value;
        if (operator === 'is_empty') onChange({ ...condition, operator: 'is_empty' });
        else if (operator === 'is_not_empty') onChange({ ...condition, operator: 'is_not_empty' });
        else if (isGuidedTextOperator(operator)) onChange({ ...condition, operator, value: 'value' in condition ? condition.value : '' });
      }}>{Object.entries(GUIDED_TEXT_OPERATORS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}<option value="is_empty">está vazio</option><option value="is_not_empty">está preenchido</option></select>
      {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <div className="space-y-2">
        <Label htmlFor={`guided-value-${condition.id}`}>Texto esperado</Label>
        <Input id={`guided-value-${condition.id}`} value={condition.value} aria-invalid={missingValue} onChange={event => onChange({ ...condition, value: event.target.value })} placeholder="Ex.: quero orçamento" />
        <p className="text-xs text-muted-foreground">Maiúsculas e acentos não alteram a comparação. A mensagem original permanece intacta.</p>
      </div>}
    </> : condition.field === 'business.trigger.stage' ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => onChange({ ...condition, operator: event.target.value === 'not_equals' ? 'not_equals' : 'equals' })}>
        <option value="equals">é</option><option value="not_equals">não é</option>
      </select>
      <GuidedBusinessStagePicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
    </> : condition.field === 'business.last_won_date' ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const operator = event.target.value;
        if (operator === 'is_empty' || operator === 'is_not_empty') onChange({ version: 1, id: condition.id, field: condition.field, operator });
        else if (isGuidedDateOperator(operator)) onChange({ version: 1, id: condition.id, field: condition.field, operator,
          value: 'value' in condition ? condition.value : '' });
      }}>{Object.entries(GUIDED_DATE_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="is_empty">está vazia</option><option value="is_not_empty">está preenchida</option></select>
      {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <div className="space-y-2">
        <Label htmlFor={`guided-value-${condition.id}`}>Valor da comparação</Label>
        <Input id={`guided-value-${condition.id}`} type="date" min="0001-01-01" max="9999-12-31" value={condition.value} aria-invalid={missingValue}
          onChange={event => onChange({ ...condition, value: event.target.value })} />
        {missingValue && <p className="text-xs text-destructive">Escolha uma data válida ou “está vazia”.</p>}
      </div>}
    </> : (condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id') ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = { version: 1 as const, id: condition.id, field: condition.field };
        if (event.target.value === 'is_empty' || event.target.value === 'is_not_empty') onChange({ ...base, operator: event.target.value });
        else onChange({ ...base, operator: event.target.value === 'not_equals' ? 'not_equals' : 'equals',
          memberId: 'memberId' in condition ? condition.memberId : '', memberLabel: 'memberLabel' in condition ? condition.memberLabel : undefined });
      }}><option value="equals">é</option><option value="not_equals">não é</option><option value="is_empty">está vazio</option><option value="is_not_empty">está preenchido</option></select>
      {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <GuidedResponsiblePicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />}
    </> : condition.field === 'lead.origin' ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = { version: 1 as const, id: condition.id, field: condition.field };
        if (event.target.value === 'is_empty' || event.target.value === 'is_not_empty') onChange({ ...base, operator: event.target.value });
        else onChange({ ...base, operator: event.target.value === 'not_equals' ? 'not_equals' : 'equals',
          originId: 'originId' in condition ? condition.originId : '', originLabel: 'originLabel' in condition ? condition.originLabel : undefined });
      }}><option value="equals">é</option><option value="not_equals">não é</option><option value="is_empty">está vazia</option><option value="is_not_empty">está preenchida</option></select>
      {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <GuidedOriginPicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />}
    </> : condition.field === 'lead.tags' ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => onChange({ ...condition, operator: event.target.value === 'not_has_tag' ? 'not_has_tag' : 'has_tag' })}>
        <option value="has_tag">tem tag</option><option value="not_has_tag">não tem tag</option>
      </select>
      <GuidedTagPicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
    </> : (condition.field === 'lead.custom' && condition.fieldType === 'select') ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = { version: 1 as const, id: condition.id, field: condition.field, fieldId: condition.fieldId, fieldType: condition.fieldType, fieldLabel: condition.fieldLabel };
        const operator = event.target.value;
        if (operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
        else if (operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
        else if (operator === 'equals' || operator === 'not_equals') onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
      }}><option value="equals">é</option><option value="not_equals">não é</option><option value="is_empty">está vazio</option><option value="is_not_empty">está preenchido</option></select>
      {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <GuidedCustomOptionPicker
        actorId={actorId} organizationId={organizationId} fieldId={condition.fieldId} id={`guided-value-${condition.id}`}
        value={condition.value} onChange={value => onChange({ ...condition, value })} />}
    </> : (condition.field === 'lead.custom' && condition.fieldType === 'date') ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = { version: 1 as const, id: condition.id, field: condition.field, fieldId: condition.fieldId, fieldType: condition.fieldType, fieldLabel: condition.fieldLabel };
        const operator = event.target.value;
        if (operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
        else if (operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
        else if (isGuidedDateOperator(operator)) onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
      }}>{Object.entries(GUIDED_DATE_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="is_empty">está vazio</option><option value="is_not_empty">está preenchido</option></select>
      {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <div className="space-y-2">
        <Label htmlFor={`guided-value-${condition.id}`}>Valor da comparação</Label>
        <Input id={`guided-value-${condition.id}`} type="date" min="0001-01-01" max="9999-12-31" value={condition.value} aria-invalid={missingValue}
          onChange={event => onChange({ ...condition, value: event.target.value })} />
        {missingValue && <p className="text-xs text-destructive">Escolha uma data válida ou “está vazio”.</p>}
      </div>}
    </> : (condition.field === 'lead.custom' && condition.fieldType === 'boolean') ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = { version: 1 as const, id: condition.id, field: condition.field, fieldId: condition.fieldId, fieldType: condition.fieldType, fieldLabel: condition.fieldLabel };
        const operator = event.target.value;
        if (operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
        else if (operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
        else if (operator === 'equals' || operator === 'not_equals') onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
      }}><option value="equals">é</option><option value="not_equals">não é</option><option value="is_empty">está vazio</option><option value="is_not_empty">está preenchido</option></select>
      {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <div className="space-y-2">
        <Label htmlFor={`guided-value-${condition.id}`}>Valor da comparação</Label>
        <select id={`guided-value-${condition.id}`} className={selectClass} value={String(condition.value)} aria-invalid={missingValue}
          onChange={event => onChange({ ...condition, value: event.target.value === '' ? '' : event.target.value === 'true' })}>
          <option value="">Selecione uma opção</option><option value="true">Sim</option><option value="false">Não</option>
        </select>
        {missingValue && <p className="text-xs text-destructive">Escolha Sim, Não ou “está vazio”.</p>}
      </div>}
    </> : condition.field === 'business.trigger.stage_elapsed' ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => isGuidedNumberOperator(event.target.value) && onChange({ ...condition, operator: event.target.value })}>
        {Object.entries(GUIDED_NUMBER_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div className="space-y-2"><Label htmlFor={`guided-value-${condition.id}`}>Tempo</Label>
          <Input id={`guided-value-${condition.id}`} type="number" min="0" step="any" value={condition.value} aria-invalid={missingValue}
            onChange={event => onChange({ ...condition, value: event.target.value === '' ? '' : event.target.valueAsNumber })} />
        </div>
        <div className="space-y-2"><Label htmlFor={`guided-unit-${condition.id}`}>Unidade</Label>
          <select id={`guided-unit-${condition.id}`} className={selectClass} value={condition.unit}
            onChange={event => onChange({ ...condition, unit: event.target.value === 'minutes' ? 'minutes' : event.target.value === 'days' ? 'days' : 'hours' })}>
            <option value="minutes">Minutos</option><option value="hours">Horas</option><option value="days">Dias</option>
          </select>
        </div>
      </div>
      {missingValue && <p className="text-xs text-destructive">Informe um tempo igual ou maior que zero.</p>}
    </> : (condition.field === 'business.trigger.value' || condition.field === 'lead.qualification_score' || (condition.field === 'lead.custom' && condition.fieldType === 'number')) ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const operator = event.target.value;
        if (condition.field === 'lead.custom') {
          const base = { version: 1 as const, id: condition.id, field: condition.field, fieldId: condition.fieldId, fieldType: condition.fieldType, fieldLabel: condition.fieldLabel };
          if (operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
          else if (operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
          else if (isGuidedNumberOperator(operator)) onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
        } else if (condition.field === 'business.trigger.value') {
          const base = { version: 1 as const, id: condition.id, field: condition.field };
          if (operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
          else if (operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
          else if (isGuidedNumberOperator(operator)) onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
        } else {
          const base = { version: 1 as const, id: condition.id, field: condition.field };
          if (operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
          else if (operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
          else if (isGuidedNumberOperator(operator)) onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
        }
      }}>{Object.entries(GUIDED_NUMBER_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="is_empty">está vazio</option><option value="is_not_empty">está preenchido</option></select>
      {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <div className="space-y-2">
        <Label htmlFor={`guided-value-${condition.id}`}>Valor da comparação</Label>
        <Input id={`guided-value-${condition.id}`} type="number" step="any" value={condition.value} aria-invalid={missingValue}
          onChange={event => onChange({ ...condition, value: event.target.value === '' ? '' : event.target.valueAsNumber })} />
        {missingValue && <p className="text-xs text-destructive">Informe um número ou escolha “está vazio”.</p>}
      </div>}
    </> : <>
    <div className="space-y-2"><Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator} onChange={event => {
        const base = condition.field === 'lead.custom'
          ? { version: 1 as const, id: condition.id, field: condition.field, fieldId: condition.fieldId, fieldType: condition.fieldType, fieldLabel: condition.fieldLabel }
          : { version: 1 as const, id: condition.id, field: condition.field };
        const operator = event.target.value;
        if (operator === 'is_empty') onChange({ ...base, operator: 'is_empty' });
        else if (operator === 'is_not_empty') onChange({ ...base, operator: 'is_not_empty' });
        else if (isGuidedTextOperator(operator)) onChange({ ...base, operator, value: 'value' in condition ? condition.value : '' });
      }}>{Object.entries(GUIDED_TEXT_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="is_empty">está vazio</option><option value="is_not_empty">está preenchido</option></select></div>
    {condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && <div className="space-y-2"><Label htmlFor={`guided-value-${condition.id}`}>Valor da comparação</Label>
      {condition.field !== 'lead.custom' && ['lead.segment', 'lead.urgency', 'lead.faturamento'].includes(condition.field) ? <GuidedLeadValuePicker key={condition.field} id={`guided-value-${condition.id}`} actorId={actorId} organizationId={organizationId}
        field={GUIDED_SCALAR_FIELDS[condition.field].column} value={condition.value} onChange={value => onChange({ ...condition, value })} /> : condition.field !== 'lead.custom' && isUtmValueField(GUIDED_SCALAR_FIELDS[condition.field].column) ? <GuidedUtmPicker key={condition.field} id={`guided-value-${condition.id}`} actorId={actorId} organizationId={organizationId}
        field={GUIDED_SCALAR_FIELDS[condition.field].column} value={condition.value} onChange={value => onChange({ ...condition, value })} /> : <Input id={`guided-value-${condition.id}`} value={condition.value} aria-invalid={missingValue}
        aria-describedby={missingValue ? `guided-value-error-${condition.id}` : undefined}
        onChange={event => onChange({ ...condition, value: event.target.value })} placeholder="Ex.: José" />}
      {missingValue && <p id={`guided-value-error-${condition.id}`} className="text-xs text-destructive">Informe um valor ou escolha “está vazio”.</p>}
      <p className="text-xs text-muted-foreground">Maiúsculas e acentos não alteram a comparação.</p></div>}
    </>}
    <Button type="button" variant="outline" disabled={groupDepth >= GUIDED_CONDITION_LIMITS.maxGroupDepth
      || treeComplexity + 2 > GUIDED_CONDITION_LIMITS.maxComplexity}
      title={groupDepth >= GUIDED_CONDITION_LIMITS.maxGroupDepth ? "Limite de três níveis de grupos. Adicione regras ao grupo existente." : undefined} onClick={() => {
      const rule = newRule(); onChange({ version: 1, id: crypto.randomUUID(), kind: 'group', match: 'all', children: [condition, rule] }); focusValue(rule.id);
    }}>Adicionar condição</Button>
  </div>;
}
