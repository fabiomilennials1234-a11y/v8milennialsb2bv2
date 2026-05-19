import { Suspense, lazy } from "react";
import { ThemeProvider } from "next-themes";
import { ThemeTransitionProvider } from "@/contexts/ThemeTransitionContext";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { OrgFeaturesProvider } from "@/contexts/OrgFeaturesContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PermissionProtectedRoute } from "@/components/PermissionProtectedRoute";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAutoAdminAssignment } from "@/hooks/useAutoAdminAssignment";
import { SubscriptionProtectedRoute } from "@/components/SubscriptionProtectedRoute";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { ServiceWorkerUpdater } from "@/components/ServiceWorkerUpdater";

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

const TrashPage = lazy(() => lazyRetry(() => import("./pages/Trash")));
const Duplicates = lazy(() => lazyRetry(() => import("./pages/Duplicates")));
const Configuracoes = lazy(() => lazyRetry(() => import("./pages/Configuracoes")));
const TVDashboard = lazy(() => lazyRetry(() => import("./pages/TVDashboard")));
const Campanhas = lazy(() => lazyRetry(() => import("./pages/Campanhas")));
const CampanhaDetail = lazy(() => lazyRetry(() => import("./pages/CampanhaDetail")));
const FunisHub = lazy(() => lazyRetry(() => import("./pages/FunisHub")));
// Marketing and Analytics are unified in the Analytics tab — see TabAnalyticsV2.tsx
const Produtos = lazy(() => lazyRetry(() => import("./pages/Produtos")));
const Negocios = lazy(() => lazyRetry(() => import("./pages/Negocios")));
const Copilot = lazy(() => lazyRetry(() => import("./pages/Copilot")));
const CopilotMetrics = lazy(() => lazyRetry(() => import("./pages/CopilotMetrics")));
const ChatWhatsApp = lazy(() => lazyRetry(() => import("./pages/ChatWhatsApp")));
// ChatSkeleton é eager (não lazy) — precisa estar disponível no instante
// em que o chunk de ChatWhatsApp começa a ser baixado.
import { ChatSkeleton } from "@/components/chat/ChatSkeleton";
const Upsell = lazy(() => lazyRetry(() => import("./pages/Upsell")));
const ClienteDetail = lazy(() => lazyRetry(() => import("./components/carteira/ClienteDetailPage")));
const CustomPipeline = lazy(() => lazyRetry(() => import("./pages/CustomPipeline")));
const Agenda = lazy(() => lazyRetry(() => import("./pages/Agenda")));
const Privacidade = lazy(() => lazyRetry(() => import("./pages/Privacidade")));
const ApiDocs = lazy(() => lazyRetry(() => import("./pages/ApiDocs")));
const CopilotPlayground = lazy(() => lazyRetry(() => import("@/components/copilot/playground").then(m => ({ default: m.CopilotPlayground }))));
const ChecklistPage = lazy(() => lazyRetry(() => import("./pages/ChecklistPage")));
const MessageTemplates = lazy(() => lazyRetry(() => import("./pages/MessageTemplates")));
const Automacoes = lazy(() => lazyRetry(() => import("./pages/Automacoes")));
const AutomacoesEditor = lazy(() => lazyRetry(() => import("./pages/AutomacoesEditor")));
const AutomacoesExecucoes = lazy(() => lazyRetry(() => import("./pages/AutomacoesExecucoes")));


const NotFound = lazy(() => lazyRetry(() => import("./pages/NotFound")));
const Landing = lazy(() => lazyRetry(() => import("./pages/Landing")));
const Signup = lazy(() => lazyRetry(() => import("./pages/Signup")));
const ResetPassword = lazy(() => lazyRetry(() => import("./pages/ResetPassword")));

// Master Admin — lazy loaded (com retry)
const MasterDashboard = lazy(() => lazyRetry(() => import("./pages/master/MasterDashboard")));
const MasterOrganizations = lazy(() => lazyRetry(() => import("./pages/master/MasterOrganizations")));
const MasterUsers = lazy(() => lazyRetry(() => import("./pages/master/MasterUsers")));
const MasterPlans = lazy(() => lazyRetry(() => import("./pages/master/MasterPlans")));
const MasterFeatures = lazy(() => lazyRetry(() => import("./pages/master/MasterFeatures")));
const MasterAuditLogs = lazy(() => lazyRetry(() => import("./pages/master/MasterAuditLogs")));
const MasterOperations = lazy(() => lazyRetry(() => import("./pages/master/MasterOperations")));
const MasterAutomationHealth = lazy(() => lazyRetry(() => import("./pages/master/MasterAutomationHealth")));
const MasterWhatsAppHealth = lazy(() => lazyRetry(() => import("./pages/master/MasterWhatsAppHealth")));
const CopilotReasoning = lazy(() => lazyRetry(() => import("./pages/master/CopilotReasoning")));
const CopilotToggleAudit = lazy(() => lazyRetry(() => import("./pages/master/CopilotToggleAudit")));
const MasterOnboarding = lazy(() => lazyRetry(() => import("./pages/master/MasterOnboarding")));
const MockupChat = lazy(() => lazyRetry(() => import("./pages/MockupChat")));
const MockupChatV2 = lazy(() => lazyRetry(() => import("./pages/MockupChatV2")));
const MockupChatV3 = lazy(() => lazyRetry(() => import("./pages/MockupChatV3")));

// Master route/layout — carregam sob demanda quando acessar /master
import { MasterRoute } from "@/components/master/MasterRoute";
import { MasterLayout } from "@/components/master/MasterLayout";

// Command Palette — global ⌘K (C24)
import { CommandPaletteProvider } from "@/components/command/CommandPaletteProvider";
import { CommandPalette as CommandPaletteComponent } from "@/components/command/CommandPalette";
import { GlobalShortcutsProvider } from "@/components/command/GlobalShortcutsProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,        // 5 minutos — dados são considerados frescos por 5 min
      gcTime: 1000 * 60 * 30,           // 30 minutos — cache mantido mais tempo para back-navigation
      refetchOnWindowFocus: false,       // NÃO refetch ao voltar na aba
      refetchOnReconnect: true,          // Refetch apenas queries stale ao reconectar (não "always")
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
        <SubscriptionProtectedRoute>
          <MainLayout>{children}</MainLayout>
        </SubscriptionProtectedRoute>
      </OnboardingGate>
    </OrgFeaturesProvider>
  );
}

// Root route: Landing for visitors, redirect for authenticated users
function RootRedirect() {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;

  if (!user) return <Navigate to="/auth" replace />;

  return <Navigate to="/dashboard" replace />;
}

// Auth route that redirects to dashboard if already logged in
function AuthRoute() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return <Auth />;
}

function PageLoader() {
  return <TorqueLoader variant="inline" />;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Landing + Signup temporariamente ocultos — redirecionam pra /auth */}
      <Route path="/landing" element={<Navigate to="/auth" replace />} />
      <Route path="/auth" element={<AuthRoute />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/signup" element={<Navigate to="/auth" replace />} />
      <Route path="/privacidade" element={<Privacidade />} />
      <Route path="/docs" element={<ApiDocs />} />
      <Route path="/_mockup/chat" element={<MockupChat />} />
      <Route path="/_mockup/chat-v2" element={<MockupChatV2 />} />
      <Route path="/_mockup/chat-v3" element={<MockupChatV3 />} />
      {/* Old onboarding/checkout routes removed — OnboardingGate handles inline */}
      <Route path="/" element={<RootRedirect />} />
      <Route path="/pricing" element={<Navigate to="/#pricing" replace />} />
      <Route
        path="/dashboard"
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
      <Route path="/marketing" element={<Navigate to="/dashboard" replace />} />
      <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />
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
        path="/checklists"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="checklists.view">
                <ChecklistPage />
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
        path="/lixeira"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="leads.view">
                <TrashPage />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/duplicatas"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="leads.view">
                <Duplicates />
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
        path="/negocios"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Negocios />
            </LayoutWrapper>
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
        path="/chat"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="whatsapp.view">
                <Suspense fallback={<ChatSkeleton />}>
                  <ChatWhatsApp />
                </Suspense>
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
                <Suspense fallback={<ChatSkeleton />}>
                  <ChatWhatsApp />
                </Suspense>
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
        path="/carteira/:clientId"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <ClienteDetail />
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
            <LayoutWrapper>
              <SubscriptionProtectedRoute requireActive>
                <CopilotPlayground />
              </SubscriptionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/:id/editar"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <SubscriptionProtectedRoute requireActive>
                <CopilotPlayground />
              </SubscriptionProtectedRoute>
            </LayoutWrapper>
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
      <Route
        path="/templates"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <MessageTemplates />
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
        <Route path="automation-health" element={<MasterAutomationHealth />} />
        <Route path="whatsapp-health" element={<MasterWhatsAppHealth />} />
        <Route path="copilot-reasoning" element={<CopilotReasoning />} />
        <Route path="copilot-toggle-audit" element={<CopilotToggleAudit />} />
        <Route path="onboarding" element={<MasterOnboarding />} />
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
            <ServiceWorkerUpdater />
            <BrowserRouter>
              <AuthProvider>
                <GlobalErrorBoundary>
                  <CommandPaletteProvider>
                    <GlobalShortcutsProvider>
                      <AppRoutes />
                      <CommandPaletteComponent />
                    </GlobalShortcutsProvider>
                  </CommandPaletteProvider>
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