import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowSidebar } from '../../../src/modules/workflows/components/WorkflowSidebar';
import type { WorkflowNode } from '../../../src/types/workflow';
import '../../../src/index.css';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Harness() {
  const [actorId, setActorId] = useState('user-1');
  const [node, setNode] = useState<WorkflowNode>({
    id: 'condition-1', type: 'condition', position: { x: 0, y: 0 },
    data: { type: 'condition', label: 'Condição', field: '', operator: 'equals', value: '',
      guidedCondition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: '' } },
  });
  return <QueryClientProvider client={client}><main className="bg-background text-foreground min-h-screen p-8 flex justify-end">
    {new URLSearchParams(location.search).has('identity-switch') && <button onClick={() => setActorId('user-2')}>Trocar usuário</button>}
    <WorkflowSidebar actorId={actorId} organizationId="org-1" selectedNode={node} onClose={() => {}} onUpdateNode={(_id, updates) => setNode(previous => ({ ...previous, data: { ...previous.data, ...updates } }))} /></main></QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
