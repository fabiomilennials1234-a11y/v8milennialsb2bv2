import { ThemeProvider } from "next-themes";
import { ThemeTransitionProvider } from "@/contexts/ThemeTransitionContext";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { OrgFeaturesProvider } from "@/contexts/OrgFeaturesContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAutoAdminAssignment } from "@/hooks/useAutoAdminAssignment";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import PipeConfirmacao from "./pages/PipeConfirmacao";
import PipePropostas from "./pages/PipePropostas";
import PipeWhatsapp from "./pages/PipeWhatsapp";
import PipeFollowUps from "./pages/PipeFollowUps";
import Ranking from "./pages/Ranking";
import Metas from "./pages/Metas";
import GestaoMetas from "./pages/GestaoMetas";
import Performance from "./pages/Performance";
import Equipe from "./pages/Equipe";
import Comissoes from "./pages/Comissoes";
import Leads from "./pages/Leads";
import Configuracoes from "./pages/Configuracoes";
import TVDashboard from "./pages/TVDashboard";
import Campanhas from "./pages/Campanhas";
import CampanhaDetail from "./pages/CampanhaDetail";
import Marketing from "./pages/Marketing";
import Produtos from "./pages/Produtos";
import Copilot from "./pages/Copilot";
import CopilotMetrics from "./pages/CopilotMetrics";
import ChatWhatsApp from "./pages/ChatWhatsApp";
import Upsell from "./pages/Upsell";
import Agenda from "./pages/Agenda";
import Privacidade from "./pages/Privacidade";
import { CopilotWizard } from "@/components/copilot/CopilotWizard";
import { SubscriptionProtectedRoute } from "@/components/SubscriptionProtectedRoute";
import NotFound from "./pages/NotFound";

// Master Admin
import { MasterRoute } from "@/components/master/MasterRoute";
import { MasterLayout } from "@/components/master/MasterLayout";
import MasterDashboard from "./pages/master/MasterDashboard";
import MasterOrganizations from "./pages/master/MasterOrganizations";
import MasterUsers from "./pages/master/MasterUsers";
import MasterPlans from "./pages/master/MasterPlans";
import MasterFeatures from "./pages/master/MasterFeatures";
import MasterAuditLogs from "./pages/master/MasterAuditLogs";

const queryClient = new QueryClient();

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function EnvMissingScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      padding: 24,
      fontFamily: 'system-ui, sans-serif',
      background: '#0f172a',
      color: '#e2e8f0',
      textAlign: 'center',
    }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 12 }}>Configuração necessária</h1>
      <p style={{ marginBottom: 16, maxWidth: 400 }}>
        No EasyPanel, em <strong>Ambiente</strong> (Environment), adicione as variáveis do Supabase e faça um novo deploy:
      </p>
      <ul style={{ textAlign: 'left', marginBottom: 16, listStyle: 'none' }}>
        <li><code style={{ background: '#334155', padding: '2px 6px' }}>VITE_SUPABASE_URL</code></li>
        <li><code style={{ background: '#334155', padding: '2px 6px' }}>VITE_SUPABASE_PUBLISHABLE_KEY</code></li>
        <li><code style={{ background: '#334155', padding: '2px 6px' }}>VITE_SUPABASE_PROJECT_ID</code></li>
      </ul>
      <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
        Depois clique em <strong>Implantar</strong> novamente.
      </p>
    </div>
  );
}

// Wrapper for pages that need the main layout
function LayoutWrapper({ children }: { children: React.ReactNode }) {
  useAutoAdminAssignment();
  return (
    <OrgFeaturesProvider>
      <MainLayout>{children}</MainLayout>
    </OrgFeaturesProvider>
  );
}

// Auth route that redirects to dashboard if already logged in
function AuthRoute() {
  const { user, loading } = useAuth();
  
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  
  return <Auth />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthRoute />} />
      <Route path="/privacidade" element={<Privacidade />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Dashboard />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/campanhas"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Campanhas />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/campanhas/:id"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <CampanhaDetail />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/marketing"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Marketing />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipe-confirmacao"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PipeConfirmacao />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipe-propostas"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PipePropostas />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/performance"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Performance />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/ranking"
        element={<Navigate to="/performance" replace />}
      />
      <Route
        path="/metas"
        element={<Navigate to="/performance" replace />}
      />
      <Route
        path="/premiacoes"
        element={<Navigate to="/performance" replace />}
      />
      <Route
        path="/gestao-metas"
        element={<Navigate to="/performance" replace />}
      />
      <Route
        path="/pipe-whatsapp"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PipeWhatsapp />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/follow-ups"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PipeFollowUps />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Leads />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/premiacoes"
        element={<Navigate to="/performance" replace />}
      />
      <Route
        path="/comissoes"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Comissoes />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipe"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Equipe />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/configuracoes"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Configuracoes />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/tv"
        element={
          <ProtectedRoute>
            <TVDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/produtos"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Produtos />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Copilot />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/metricas"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <CopilotMetrics />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat-whatsapp"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <ChatWhatsApp />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/upsell"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Upsell />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/agenda"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Agenda />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/novo"
        element={
          <ProtectedRoute>
            <SubscriptionProtectedRoute requireActive>
              <LayoutWrapper>
                <CopilotWizard />
              </LayoutWrapper>
            </SubscriptionProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/:id/editar"
        element={
          <ProtectedRoute>
            <SubscriptionProtectedRoute requireActive>
              <LayoutWrapper>
                <CopilotWizard />
              </LayoutWrapper>
            </SubscriptionProtectedRoute>
          </ProtectedRoute>
        }
      />
      {/* Master Admin Routes */}
      <Route
        path="/master"
        element={
          <ProtectedRoute>
            <MasterRoute>
              <MasterLayout />
            </MasterRoute>
          </ProtectedRoute>
        }
      >
        <Route index element={<MasterDashboard />} />
        <Route path="organizations" element={<MasterOrganizations />} />
        <Route path="users" element={<MasterUsers />} />
        <Route path="plans" element={<MasterPlans />} />
        <Route path="features" element={<MasterFeatures />} />
        <Route path="audit-logs" element={<MasterAuditLogs />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => {
  const hasSupabaseEnv = Boolean(SUPABASE_URL?.trim() && SUPABASE_ANON_KEY?.trim());
  if (!hasSupabaseEnv) {
    return <EnvMissingScreen />;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" storageKey="v8-theme" enableSystem>
        <ThemeTransitionProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
                <AppRoutes />
              </AuthProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeTransitionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
