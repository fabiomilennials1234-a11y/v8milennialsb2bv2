import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '../../../src/modules/identity/auth/contexts/AuthContext';
import AutomacoesEditor from '../../../src/modules/workflows/pages/AutomacoesEditor';
import '../../../src/index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><AuthProvider>
    <MemoryRouter initialEntries={[new URLSearchParams(location.search).has('new') ? '/automacoes/novo' : '/automacoes/workflow-1']}>
      <nav><Link to="/automacoes/workflow-1">Automação A</Link><Link to="/automacoes/workflow-2">Automação B</Link></nav>
      <div className="h-screen"><Routes><Route path="/automacoes/:id" element={<AutomacoesEditor />} /></Routes><Toaster /></div>
    </MemoryRouter>
  </AuthProvider></QueryClientProvider>,
);
