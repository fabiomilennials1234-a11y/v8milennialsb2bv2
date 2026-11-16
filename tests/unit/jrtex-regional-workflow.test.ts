import { describe,it,expect } from 'vitest';
import { regionalWorkflow } from '../../scripts/lib/jrtex-regional-workflow.mjs';
import { findNodeConfigIssues } from '../../src/contracts/workflows/node-requirements';
import { isGuidedCondition, guidedConditionFields } from '../../supabase/functions/_shared/guided-condition';
import { validateWorkflow } from '../../supabase/functions/_shared/workflow-schema/validator';
describe('JRtex qualification workflow',()=>{
 const workflow=regionalWorkflow({instanceId:'859ee852-2102-4a5d-b249-98a6fe0b601c',pipelineId:'commercial',triageMemberId:'ea4ab4ff-f7c7-4053-8d1f-d6ea742feb71',statusFieldId:'7e1f7cad-af35-4d40-a5ed-c85ccf58e644'});
 it('passes server graph and guided-condition publication contracts',()=>{
   expect(validateWorkflow(workflow.definition).errors.filter(e=>e.severity==='error')).toEqual([]);
   const conditions=workflow.definition.nodes.filter(n=>n.type==='condition').map(n=>n.data.guidedCondition);
   expect(conditions.every(isGuidedCondition)).toBe(true);
   expect([...new Set(conditions.flatMap(guidedConditionFields))]).toEqual(workflow.required_fields);
 });
 it('uses the published question contract with every response and failure handled',()=>{
   // Conditions require server publication; this is the same question-only
   // contract checked by the executor after loading that published version.
   expect(findNodeConfigIssues(workflow.definition.nodes,workflow.definition.edges).filter(issue=>issue.actionType!=='condition')).toEqual([]);
 });
 it('scopes all entries to the commercial pipeline and requests mandatory CNPJ',()=>{
   expect(workflow.trigger_config).toEqual({filter_pipeline_id:'commercial'});
   expect(workflow.definition.nodes.find(n=>n.id==='collect')?.data.text).toContain('CNPJ');
   expect(workflow.definition.nodes.some(n=>n.type==='assign_responsible'||n.type==='split_ab')).toBe(false);
 });
 it('greets existing owners before checking assignment and treats Karine as triage',()=>{
   expect(workflow.definition.edges.find(e=>e.source==='trigger')?.target).toBe('hello');
   expect(workflow.definition.edges.find(e=>e.source==='hello'&&!e.sourceHandle)?.target).toBe('owner_initial');
   expect(workflow.definition.nodes.find(n=>n.id==='owner_initial')?.data.guidedCondition.children[1]).toMatchObject({operator:'not_equals',memberId:'ea4ab4ff-f7c7-4053-8d1f-d6ea742feb71'});
 });
});
