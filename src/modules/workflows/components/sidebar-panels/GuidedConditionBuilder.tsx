import { GuidedCustomOptionPicker } from './GuidedCustomOptionPicker';
import { GUIDED_DATE_OPERATORS, isGuidedCalendarDate, isGuidedDateOperator } from '@/contracts/workflows/guided-dates';
import { GuidedFieldPicker } from './GuidedFieldPicker';
import { isGuidedResponsibleField, GUIDED_SCALAR_FIELDS, GUIDED_NUMBER_OPERATORS, isGuidedNumberField, isGuidedNumberOperator, GUIDED_TEXT_OPERATORS, isGuidedTextField, isGuidedTextOperator } from '@/contracts/workflows/guided-fields';
import { summarizeGuidedCondition } from '../../lib/guided-condition-summary';
import { useLayoutEffect, useRef, useState } from 'react';
import type { GuidedConditionDraft, GuidedRuleDraft } from '@/types/workflow';
import { GuidedLeadValuePicker } from './GuidedLeadValuePicker';
import { GuidedUtmPicker } from './GuidedUtmPicker';
import { isUtmValueField } from '../../hooks/useOrgUtmValues';
import { GuidedResponsiblePicker } from './GuidedResponsiblePicker';
import { GuidedOriginPicker } from './GuidedOriginPicker';
import { GuidedTagPicker } from './GuidedTagPicker';
import { GuidedBusinessStagePicker } from './GuidedBusinessStagePicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function isIncompleteGuidedDraft(condition: GuidedConditionDraft): boolean {
  return 'children' in condition ? !condition.children.length || condition.children.some(isIncompleteGuidedDraft)
    : condition.field === 'business.trigger.stage' ? !condition.pipelineId || !condition.stageId
    : condition.field === 'business.trigger.value' ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty'
      && (condition.value === '' || !Number.isFinite(condition.value))
    : condition.field === 'business.trigger.stage_elapsed' ? condition.value === '' || !Number.isFinite(condition.value) || condition.value < 0
    : condition.field === 'lead.custom' && !condition.fieldId ? true
    : condition.field === 'lead.custom' && condition.fieldType === 'date' ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && !isGuidedCalendarDate(condition.value)
    : (condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id') ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && !condition.memberId
    : condition.field === 'lead.origin' ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && !condition.originId
    : condition.field === 'lead.tags' ? !condition.tagId : condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && (condition.value === '' || (typeof condition.value === 'number' && !Number.isFinite(condition.value)));
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
          pendingFocus.current = `guided-${'children' in copy ? 'match' : copy.operator !== 'is_empty' && copy.operator !== 'is_not_empty' ? 'value' : 'operator'}-${copy.id}`;
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
            const compatible = condition.field === 'lead.custom' && condition.fieldType === 'date';
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
        else if (isGuidedTextField(field)) onChange(condition.field === 'business.trigger.stage' || condition.field === 'business.trigger.value' || condition.field === 'business.trigger.stage_elapsed' || condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id' || condition.field === 'lead.origin' || condition.field === 'lead.tags' || condition.field === 'lead.qualification_score' || (condition.field === 'lead.custom' && condition.fieldType !== 'text')
          ? { version: 1, id: condition.id, field, operator: 'equals', value: '' }
          : { version: 1, id: condition.id, field, ...(condition.operator === 'is_empty' || condition.operator === 'is_not_empty' ? { operator: condition.operator } : { operator: condition.operator, value: condition.value }) });
      }} /></div>
    {fieldReset && missingValue && <p className="text-xs text-muted-foreground" aria-live="polite">A informação mudou. Defina uma nova comparação.</p>}
    {condition.field === 'business.trigger.stage' ? <>
      <Label htmlFor={`guided-operator-${condition.id}`}>Comparação</Label>
      <select id={`guided-operator-${condition.id}`} className={selectClass} value={condition.operator}
        onChange={event => onChange({ ...condition, operator: event.target.value === 'not_equals' ? 'not_equals' : 'equals' })}>
        <option value="equals">é</option><option value="not_equals">não é</option>
      </select>
      <GuidedBusinessStagePicker actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
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
    <Button type="button" variant="outline" disabled={groupDepth >= 3} title={groupDepth >= 3 ? "Limite de três níveis de grupos. Adicione regras ao grupo existente." : undefined} onClick={() => {
      const rule = newRule(); onChange({ version: 1, id: crypto.randomUUID(), kind: 'group', match: 'all', children: [condition, rule] }); focusValue(rule.id);
    }}>Adicionar condição</Button>
  </div>;
}
