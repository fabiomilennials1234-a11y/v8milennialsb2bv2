import { Suspense, lazy } from "react";
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
import { PermissionProtectedRoute } from "@/components/PermissionProtectedRoute";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAutoAdminAssignment } from "@/hooks/useAutoAdminAssignment";
import { SubscriptionProtectedRoute } from "@/components/SubscriptionProtectedRoute";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { Loader2 } from "lucide-react";

// Retry helper para chunks que falham ao carregar (comum após deploy)
function lazyRetry<T extends { default: any }>(
  importFn: () => Promise<T>,
  retries = 2
): Promise<T> {
  return importFn().catch((err) => {
    if (retries > 0) {
      return new Promise<T>((resolve) =>
        setTimeout(() => resolve(lazyRetry(importFn, retries - 1)), 1000)
      );
    }
    throw err;
  });
}

// Lazy-loaded pages — cada página vira um chunk separado (com retry automático)
const Auth = lazy(() => lazyRetry(() => import("./pages/Auth")));
const Dashboard = lazy(() => lazyRetry(() => import("./pages/Dashboard")));
const PipeConfirmacao = lazy(() => lazyRetry(() => import("./pages/PipeConfirmacao")));
const PipePropostas = lazy(() => lazyRetry(() => import("./pages/PipePropostas")));
const PipeWhatsapp = lazy(() => lazyRetry(() => import("./pages/PipeWhatsapp")));
const PipeFollowUps = lazy(() => lazyRetry(() => import("./pages/PipeFollowUps")));
const Revisao = lazy(() => lazyRetry(() => import("./pages/Revisao")));
const Performance = lazy(() => lazyRetry(() => import("./pages/Performance")));
const Equipe = lazy(() => lazyRetry(() => import("./pages/Equipe")));
const Comissoes = lazy(() => lazyRetry(() => import("./pages/Comissoes")));
const Leads = lazy(() => lazyRetry(() => import("./pages/Leads")));
const Configuracoes = lazy(() => lazyRetry(() => import("./pages/Configuracoes")));
const TVDashboard = lazy(() => lazyRetry(() => import("./pages/TVDashboard")));
const Campanhas = lazy(() => lazyRetry(() => import("./pages/Campanhas")));
const CampanhaDetail = lazy(() => lazyRetry(() => import("./pages/CampanhaDetail")));
const FunisHub = lazy(() => lazyRetry(() => import("./pages/FunisHub")));
const Marketing = lazy(() => lazyRetry(() => import("./pages/Marketing")));
const Analytics = lazy(() => lazyRetry(() => import("./pages/Analytics")));
const Produtos = lazy(() => lazyRetry(() => import("./pages/Produtos")));
const Copilot = lazy(() => lazyRetry(() => import("./pages/Copilot")));
const CopilotMetrics = lazy(() => lazyRetry(() => import("./pages/CopilotMetrics")));
const ChatWhatsApp = lazy(() => lazyRetry(() => import("./pages/ChatWhatsApp")));
const Upsell = lazy(() => lazyRetry(() => import("./pages/Upsell")));
const CustomPipeline = lazy(() => lazyRetry(() => import("./pages/CustomPipeline")));
const Agenda = lazy(() => lazyRetry(() => import("./pages/Agenda")));
const Privacidade = lazy(() => lazyRetry(() => import("./pages/Privacidade")));
const ApiDocs = lazy(() => lazyRetry(() => import("./pages/ApiDocs")));
const CopilotWizard = lazy(() => lazyRetry(() => import("@/components/copilot/CopilotWizard").then(m => ({ default: m.CopilotWizard }))));
const CopilotPlayground = lazy(() => lazyRetry(() => import("@/components/copilot/playground").then(m => ({ default: m.CopilotPlayground }))));
const CopilotWizardTest = lazy(() => lazyRetry(() => import("./pages/CopilotWizardTest")));
const Automacoes = lazy(() => lazyRetry(() => import("./pages/Automacoes")));
const AutomacoesEditor = lazy(() => lazyRetry(() => import("./pages/AutomacoesEditor")));
const AutomacoesExecucoes = lazy(() => lazyRetry(() => import("./pages/AutomacoesExecucoes")));
const NotFound = lazy(() => lazyRetry(() => import("./pages/NotFound")));
const Landing = lazy(() => lazyRetry(() => import("./pages/Landing")));
const Signup = lazy(() => lazyRetry(() => import("./pages/Signup")));
const Onboarding = lazy(() => lazyRetry(() => import("./pages/Onboarding")));

// Master Admin — lazy loaded (com retry)
const MasterDashboard = lazy(() => lazyRetry(() => import("./pages/master/MasterDashboard")));
const MasterOrganizations = lazy(() => lazyRetry(() => import("./pages/master/MasterOrganizations")));
const MasterUsers = lazy(() => lazyRetry(() => import("./pages/master/MasterUsers")));
const MasterPlans = lazy(() => lazyRetry(() => import("./pages/master/MasterPlans")));
const MasterFeatures = lazy(() => lazyRetry(() => import("./pages/master/MasterFeatures")));
const MasterAuditLogs = lazy(() => lazyRetry(() => import("./pages/master/MasterAuditLogs")));
const MasterOperations = lazy(() => lazyRetry(() => import("./pages/master/MasterOperations")));

// Master route/layout — carregam sob demanda quando acessar /master
import { MasterRoute } from "@/components/master/MasterRoute";
import { MasterLayout } from "@/components/master/MasterLayout";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,        // 5 minutos — dados são considerados frescos por 5 min
      gcTime: 1000 * 60 * 10,           // 10 minutos — cache mantido 10 min após inativo
      refetchOnWindowFocus: false,       // NÃO refetch ao voltar na aba
      refetchOnReconnect: "always",      // Refetch ao reconectar internet
      retry: 1,                          // 1 retry em caso de erro
    },
  },
});

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
      <OnboardingGate>
        <MainLayout>{children}</MainLayout>
      </OnboardingGate>
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

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/landing" element={<Landing />} />
      <Route path="/auth" element={<AuthRoute />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/privacidade" element={<Privacidade />} />
      <Route path="/docs" element={<ApiDocs />} />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OrgFeaturesProvider>
              <Onboarding />
            </OrgFeaturesProvider>
          </ProtectedRoute>
        }
      />
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
        path="/funis"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="pipeline.view">
                <FunisHub />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/campanhas"
        element={<Navigate to="/funis" replace />}
      />
      <Route
        path="/campanhas/:id"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="campaigns.view">
                <CampanhaDetail />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/marketing"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="marketing.view">
                <Marketing />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <MasterRoute>
              <LayoutWrapper>
                <PermissionProtectedRoute featureKey="analytics.view">
                  <Analytics />
                </PermissionProtectedRoute>
              </LayoutWrapper>
            </MasterRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipe-confirmacao"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="pipeline.view">
                <PipeConfirmacao />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipe-propostas"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="pipeline.view">
                <PipePropostas />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/performance"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="performance.view">
                <Performance />
              </PermissionProtectedRoute>
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
              <PermissionProtectedRoute featureKey="pipeline.view">
                <PipeWhatsapp />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/follow-ups"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="followups.view">
                <Revisao />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="leads.view">
                <Leads />
              </PermissionProtectedRoute>
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
              <PermissionProtectedRoute featureKey="commissions.view">
                <Comissoes />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/equipe"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="team.view">
                <Equipe />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/configuracoes"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="settings.view">
                <Configuracoes />
              </PermissionProtectedRoute>
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
              <PermissionProtectedRoute featureKey="products.view">
                <Produtos />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="copilot.view">
                <Copilot />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/metricas"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="copilot.view">
                <CopilotMetrics />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/teste-wizard"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <CopilotWizardTest />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="whatsapp.view">
                <ChatWhatsApp />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat-whatsapp"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="whatsapp.view">
                <ChatWhatsApp />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/upsell"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="upsell.view">
                <Upsell />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipe/custom/:slug"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="pipeline.view">
                <CustomPipeline />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/agenda"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="agenda.view">
                <Agenda />
              </PermissionProtectedRoute>
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
                <CopilotPlayground />
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
                <CopilotPlayground />
              </LayoutWrapper>
            </SubscriptionProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/novo-wizard"
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
        path="/automacoes"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="workflows.view">
                <Automacoes />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automacoes/novo"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="workflows.view">
                <AutomacoesEditor />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automacoes/:id"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="workflows.view">
                <AutomacoesEditor />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automacoes/:id/execucoes"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="workflows.view">
                <AutomacoesExecucoes />
              </PermissionProtectedRoute>
            </LayoutWrapper>
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
        <Route path="operations" element={<MasterOperations />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
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
                <GlobalErrorBoundary>
                  <AppRoutes />
                </GlobalErrorBoundary>
              </AuthProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeTransitionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
