import { Suspense, lazy } from "react";
import { ThemeProvider } from "next-themes";
import { ThemeTransitionProvider } from "@/contexts/ThemeTransitionContext";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/modules/identity/auth";
import { useOrganization } from "@/modules/identity/org-team/hooks/useOrganization";
import { RealtimeOrgProvider } from "@/shared/realtime/realtime-org-context";
import { OrgFeaturesProvider } from "@/contexts/OrgFeaturesContext";
import { PipeOpsProvider } from "@/modules/pipelines";
import { ProtectedRoute } from "@/modules/identity/auth";
import { PermissionProtectedRoute } from "@/modules/identity/permissions";
import { MainLayout } from "@/modules/platform/components/layout/MainLayout";
import { TorqueIntro } from "@/modules/platform/components/layout/TorqueIntro";
import { useAutoAdminAssignment } from "@/modules/identity/hooks/useAutoAdminAssignment";
import { SubscriptionProtectedRoute } from "@/modules/identity/components/SubscriptionProtectedRoute";
import { GlobalErrorBoundary } from "@/modules/platform/components/GlobalErrorBoundary";
import { OnboardingGate } from "@/modules/platform/components/onboarding/OnboardingGate";
import { FeatureRoute } from "@/modules/platform";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { ServiceWorkerUpdater } from "@/modules/platform/components/ServiceWorkerUpdater";
import { PushPermissionPrompt } from "@/modules/platform/components/PushPermissionPrompt";
import { B2BSummitTicketPopup } from "@/modules/platform/components/promo/B2BSummitTicketPopup";

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
const Auth = lazy(() => lazyRetry(() => import("@/modules/identity/pages/Auth")));
const Dashboard = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/Dashboard")));
const PipeConfirmacao = lazy(() => lazyRetry(() => import("@/modules/pipelines/pages/PipeConfirmacao")));
const PipePropostas = lazy(() => lazyRetry(() => import("@/modules/pipelines/pages/PipePropostas")));
const PipeWhatsapp = lazy(() => lazyRetry(() => import("@/modules/pipelines/pages/PipeWhatsapp")));
const Revisao = lazy(() => lazyRetry(() => import("@/modules/engagement/pages/Revisao")));
const Performance = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/Performance")));
const Equipe = lazy(() => lazyRetry(() => import("@/modules/identity/org-team/pages/Equipe")));
const Comissoes = lazy(() => lazyRetry(() => import("@/modules/engagement/pages/Comissoes")));
const Leads = lazy(() => lazyRetry(() => import("@/modules/leads/pages/Leads")));

const TrashPage = lazy(() => lazyRetry(() => import("@/modules/leads/pages/Trash")));
const Duplicates = lazy(() => lazyRetry(() => import("@/modules/leads/pages/Duplicates")));
const Configuracoes = lazy(() => lazyRetry(() => import("@/modules/platform/pages/Configuracoes")));
const TVDashboard = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/TVDashboard")));
const DisparosPanel = lazy(() => lazyRetry(() => import("@/modules/campaigns/pages/DisparosPanel")));
const NovoDisparo = lazy(() => lazyRetry(() => import("@/modules/campaigns/pages/NovoDisparo")));
const FunisHub = lazy(() => lazyRetry(() => import("@/modules/pipelines/pages/FunisHub")));
// Marketing and Analytics are unified in the Analytics tab — see TabAnalyticsV2.tsx
const Produtos = lazy(() => lazyRetry(() => import("@/modules/carteira/pages/Produtos")));
const Negocios = lazy(() => lazyRetry(() => import("@/modules/pipelines/pages/Negocios")));
const Copilot = lazy(() => lazyRetry(() => import("@/modules/copilot/pages/Copilot")));
const CopilotMetrics = lazy(() => lazyRetry(() => import("@/modules/copilot/pages/CopilotMetrics")));
const ChatWhatsApp = lazy(() => lazyRetry(() => import("@/modules/communication/pages/ChatWhatsApp")));
const AtendimentoMeta = lazy(() => lazyRetry(() => import("@/modules/communication/pages/AtendimentoMeta")));
// ChatSkeleton é eager (não lazy) — precisa estar disponível no instante
// em que o chunk de ChatWhatsApp começa a ser baixado.
import { ChatSkeleton } from "@/modules/communication/components/chat/ChatSkeleton";
const Upsell = lazy(() => lazyRetry(() => import("@/modules/carteira/pages/Upsell")));
const ClienteDetail = lazy(() => lazyRetry(() => import("@/modules/carteira/components/client/ClienteDetailPage")));
const CustomPipeline = lazy(() => lazyRetry(() => import("@/modules/pipelines/pages/CustomPipeline")));
const Agenda = lazy(() => lazyRetry(() => import("@/modules/engagement/pages/Agenda")));
const Privacidade = lazy(() => lazyRetry(() => import("@/modules/platform/pages/Privacidade")));
const Faq = lazy(() => lazyRetry(() => import("@/modules/platform/pages/Faq")));
const CopilotPlayground = lazy(() => lazyRetry(() => import("@/modules/copilot/components/playground").then(m => ({ default: m.CopilotPlayground }))));
const ChecklistPage = lazy(() => lazyRetry(() => import("@/modules/engagement/pages/ChecklistPage")));
const MessageTemplates = lazy(() => lazyRetry(() => import("@/modules/communication/pages/MessageTemplates")));
const Automacoes = lazy(() => lazyRetry(() => import("./modules/workflows/pages/Automacoes")));
const AutomacoesEditor = lazy(() => lazyRetry(() => import("./modules/workflows/pages/AutomacoesEditor")));
const AutomacoesExecucoes = lazy(() => lazyRetry(() => import("./modules/workflows/pages/AutomacoesExecucoes")));


const NotFound = lazy(() => lazyRetry(() => import("@/modules/platform/pages/NotFound")));
const Landing = lazy(() => lazyRetry(() => import("@/modules/marketing/pages/Landing")));
const Signup = lazy(() => lazyRetry(() => import("@/modules/identity/pages/Signup")));
const ResetPassword = lazy(() => lazyRetry(() => import("@/modules/identity/pages/ResetPassword")));

// Master Admin — lazy loaded (com retry)
const MasterDashboard = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterDashboard")));
const MasterOrganizations = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterOrganizations")));
const MasterUsers = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterUsers")));
const MasterPlans = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterPlans")));
const MasterFeatures = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterFeatures")));
const MasterAuditLogs = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterAuditLogs")));
const MasterOperations = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterOperations")));
const MasterAutomationHealth = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterAutomationHealth")));
const MasterWhatsAppHealth = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterWhatsAppHealth")));
const CopilotReasoning = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/CopilotReasoning")));
const CopilotToggleAudit = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/CopilotToggleAudit")));
const MasterOnboarding = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterOnboarding")));
const MasterMetaAssets = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterMetaAssets")));
// Revisão master de stage_role won/lost (#991, ADR-0017 §1)
const MasterStageRoleReview = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterStageRoleReview")));
// Insights — área master azul de unit economics (chrome próprio, fora do MasterLayout)
const MasterInsights = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterInsights")));
// Master route/layout — carregam sob demanda quando acessar /master
import { MasterRoute } from "@/modules/identity/master/components/MasterRoute";
import { MasterLayout } from "@/modules/identity/master/components/MasterLayout";

// Command Palette — global ⌘K (C24)
import { CommandPaletteProvider } from "@/modules/platform/components/command/CommandPaletteProvider";
import { CommandPalette as CommandPaletteComponent } from "@/modules/platform/components/command/CommandPalette";
import { GlobalShortcutsProvider } from "@/modules/platform/components/command/GlobalShortcutsProvider";

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

// Alimenta o contexto de org-id do realtime (shared) a partir do identity.
// Inverte o edge realtime→identity (slice 9.1b). Reativo a org switch.
function RealtimeOrgBridge({ children }: { children: React.ReactNode }) {
  const { organizationId } = useOrganization();
  return <RealtimeOrgProvider organizationId={organizationId}>{children}</RealtimeOrgProvider>;
}

// Wrapper for pages that need the main layout
function LayoutWrapper({ children }: { children: React.ReactNode }) {
  useAutoAdminAssignment();
  return (
    <OrgFeaturesProvider>
      <OnboardingGate>
        <SubscriptionProtectedRoute>
          {/* Promo B2B Summit (23 jul 2026) — remover após o evento */}
          <B2BSummitTicketPopup />
          <MainLayout>{children}</MainLayout>
        </SubscriptionProtectedRoute>
      </OnboardingGate>
    </OrgFeaturesProvider>
  );
}

// Root route: always show Landing Page
function RootRedirect() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return <Landing />;
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
      <Route path="/landing" element={<Landing />} />
      <Route path="/auth" element={<AuthRoute />} />
      {/* Self-hosted reset: token vem no path. A rota sem token renderiza o
          estado "link inválido" amigável (mesma página). */}
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Signup dedicado — renderiza a página (honra ?plan vindo do pricing) em vez de redirecionar p/ /auth e perder o plano */}
      <Route path="/signup" element={<Signup />} />
      <Route path="/privacidade" element={<Privacidade />} />
      {/* DEV-only: preview do popup B2B Summit sem auth */}
      {import.meta.env.DEV && (
        <Route
          path="/b2b-summit-preview"
          element={
            <div className="dark min-h-screen bg-background">
              <B2BSummitTicketPopup forceOpen />
            </div>
          }
        />
      )}
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
                <FeatureRoute feature="funnels"><FunisHub /></FeatureRoute>
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      {/* /campanhas — Kanban de campanhas legado RETIRADO; redireciona pros funis (links antigos) */}
      <Route
        path="/campanhas"
        element={<Navigate to="/funis" replace />}
      />
      {/* /disparos — porta canônica, aberta a qualquer membro (#904, sem gate de feature) */}
      <Route
        path="/disparos"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="whatsapp_bulk">
              <DisparosPanel />
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/disparos/novo"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="whatsapp_bulk">
              <NovoDisparo />
            </FeatureRoute></LayoutWrapper>
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
                <FeatureRoute feature="funnels"><PipeConfirmacao /></FeatureRoute>
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
                <FeatureRoute feature="funnels"><PipePropostas /></FeatureRoute>
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
                <FeatureRoute feature="performance"><Performance /></FeatureRoute>
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
                <FeatureRoute feature="funnels"><PipeWhatsapp /></FeatureRoute>
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/faq"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Faq />
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
                <FeatureRoute feature="review"><Revisao /></FeatureRoute>
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
                <FeatureRoute feature="leads"><Leads /></FeatureRoute>
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/lixeira"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="leads">
              <PermissionProtectedRoute featureKey="leads.view">
                <TrashPage />
              </PermissionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/duplicatas"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="leads">
              <PermissionProtectedRoute featureKey="leads.view">
                <Duplicates />
              </PermissionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/comissoes"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="commissions.view">
                <FeatureRoute feature="commissions"><Comissoes /></FeatureRoute>
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
            {/* Rota standalone (sem LayoutWrapper) — precisa do OrgFeaturesProvider
                explícito, pois é o LayoutWrapper que o monta nas demais rotas.
                Sem ele, o FeatureRoute → useOrgFeatures() estoura. */}
            <OrgFeaturesProvider>
              <FeatureRoute feature="tv_dashboard"><TVDashboard /></FeatureRoute>
            </OrgFeaturesProvider>
          </ProtectedRoute>
        }
      />
      <Route
        path="/negocios"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <FeatureRoute feature="deals"><Negocios /></FeatureRoute>
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
                <FeatureRoute feature="products"><Produtos /></FeatureRoute>
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
                <FeatureRoute feature="copilot"><Copilot /></FeatureRoute>
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/metricas"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="copilot">
              <PermissionProtectedRoute featureKey="copilot.view">
                <CopilotMetrics />
              </PermissionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      {/* /chat — alias legado consolidado em /chat-whatsapp (canônico: deep-links ?phone/?instance, sidebar, prefetch/skeleton) */}
      <Route path="/chat" element={<Navigate to="/chat-whatsapp" replace />} />
      <Route
        path="/chat-whatsapp"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="whatsapp.view">
                <FeatureRoute feature="chat">
                  <Suspense fallback={<ChatSkeleton />}>
                    <ChatWhatsApp />
                  </Suspense>
                </FeatureRoute>
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/atendimento/meta"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="chat">
              <PermissionProtectedRoute featureKey="whatsapp.view">
                <Suspense fallback={<ChatSkeleton />}>
                  <AtendimentoMeta />
                </Suspense>
              </PermissionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/upsell"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="upsell.view">
                <FeatureRoute feature="carteira"><Upsell /></FeatureRoute>
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/carteira/:clientId"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="carteira">
              <ClienteDetail />
            </FeatureRoute></LayoutWrapper>
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
            <LayoutWrapper><FeatureRoute feature="copilot">
              <SubscriptionProtectedRoute requireActive>
                <CopilotPlayground />
              </SubscriptionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/copilot/:id/editar"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="copilot">
              <SubscriptionProtectedRoute requireActive>
                <CopilotPlayground />
              </SubscriptionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automacoes"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="automations">
              <PermissionProtectedRoute featureKey="workflows.view">
                <Automacoes />
              </PermissionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automacoes/novo"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="automations">
              <PermissionProtectedRoute featureKey="workflows.view">
                <AutomacoesEditor />
              </PermissionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automacoes/:id"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="automations">
              <PermissionProtectedRoute featureKey="workflows.view">
                <AutomacoesEditor />
              </PermissionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automacoes/:id/execucoes"
        element={
          <ProtectedRoute>
            <LayoutWrapper><FeatureRoute feature="automations">
              <PermissionProtectedRoute featureKey="workflows.view">
                <AutomacoesExecucoes />
              </PermissionProtectedRoute>
            </FeatureRoute></LayoutWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/templates"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <FeatureRoute feature="message_templates"><MessageTemplates /></FeatureRoute>
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
        <Route path="meta-assets" element={<MasterMetaAssets />} />
        <Route path="stage-roles" element={<MasterStageRoleReview />} />
      </Route>

      {/* Insights — área master azul (top-level, chrome próprio, sem MasterLayout) */}
      <Route
        path="/insights"
        element={
          <ProtectedRoute>
            <MasterRoute>
              <MasterInsights />
            </MasterRoute>
          </ProtectedRoute>
        }
      />

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
                <TorqueIntro />
                <RealtimeOrgBridge>
                  <PipeOpsProvider>
                    <GlobalErrorBoundary>
                      <PushPermissionPrompt />
                      <CommandPaletteProvider>
                        <GlobalShortcutsProvider>
                          <AppRoutes />
                          <CommandPaletteComponent />
                        </GlobalShortcutsProvider>
                      </CommandPaletteProvider>
                    </GlobalErrorBoundary>
                  </PipeOpsProvider>
                </RealtimeOrgBridge>
              </AuthProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeTransitionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;