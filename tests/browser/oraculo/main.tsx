// Browser-only test entry; excluded from the production entrypoint.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../../src/modules/identity';
import Oraculo from '../../../src/modules/copilot/pages/Oraculo';
import '../../../src/index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function Harness() {
  return <QueryClientProvider client={queryClient}><AuthProvider>
    <button onClick={() => {
      localStorage.setItem('selected_org_id', '20000000-0000-4000-8000-000000000002');
      void queryClient.invalidateQueries({ queryKey: ['team_members'] });
    }}>Selecionar organização B</button>
    <Oraculo />
  </AuthProvider></QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
