import { Suspense, lazy } from "react";
import { ThemeProvider } from "next-themes";
import { ThemeTransitionProvider } from "@/contexts/ThemeTransitionContext";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { PilhaDeCartoes } from "@/modules/platform/components/notifications/PilhaDeCartoes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
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
import { useMasterAuth } from "@/modules/identity/master/hooks/useMasterAuth";
import { useGestor } from "@/modules/identity/gestor/hooks/useGestor";
import { GestorRoute } from "@/modules/identity/gestor/components/GestorRoute";
import { resolveBootRedirect } from "@/modules/identity/auth/lib/boot-gate";
import { GlobalErrorBoundary } from "@/modules/platform/components/GlobalErrorBoundary";
import { OnboardingGate } from "@/modules/platform/components/onboarding/OnboardingGate";
import { FeatureRoute } from "@/modules/platform";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { ServiceWorkerUpdater } from "@/modules/platform/components/ServiceWorkerUpdater";
import { PushPermissionPrompt } from "@/modules/platform/components/PushPermissionPrompt";

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
const MetricsStudio = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/MetricsStudio")));
const Revisao = lazy(() => lazyRetry(() => import("@/modules/engagement/pages/Revisao")));
const Performance = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/Performance")));
const Equipe = lazy(() => lazyRetry(() => import("@/modules/identity/org-team/pages/Equipe")));
const Comissoes = lazy(() => lazyRetry(() => import("@/modules/engagement/pages/Comissoes")));
const Leads = lazy(() => lazyRetry(() => import("@/modules/leads/pages/Leads")));

const TrashPage = lazy(() => lazyRetry(() => import("@/modules/leads/pages/Trash")));
const Duplicates = lazy(() => lazyRetry(() => import("@/modules/leads/pages/Duplicates")));
const Configuracoes = lazy(() => lazyRetry(() => import("@/modules/platform/pages/Configuracoes")));
const TVDashboard = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/TVDashboard")));
const TvRenderersDemo = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/TvRenderersDemo")));
const TvWallPreview = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/TvWallPreview")));
const DisparosPanel = lazy(() => lazyRetry(() => import("@/modules/campaigns/pages/DisparosPanel")));
const NovoDisparo = lazy(() => lazyRetry(() => import("@/modules/campaigns/pages/NovoDisparo")));
const FunisHub = lazy(() => lazyRetry(() => import("@/modules/pipelines/pages/FunisHub")));
// Marketing and Analytics are unified in the Analytics tab — see TabAnalyticsV2.tsx
const Produtos = lazy(() => lazyRetry(() => import("@/modules/carteira/pages/Produtos")));
const Copilot = lazy(() => lazyRetry(() => import("@/modules/copilot/pages/Copilot")));
const CopilotMetrics = lazy(() => lazyRetry(() => import("@/modules/copilot/pages/CopilotMetrics")));
const Oraculo = lazy(() => lazyRetry(() => import("@/modules/copilot/pages/Oraculo")));
const ChatWhatsApp = lazy(() => lazyRetry(() => import("@/modules/communication/pages/ChatWhatsApp")));
const AtendimentoMeta = lazy(() => lazyRetry(() => import("@/modules/communication/pages/AtendimentoMeta")));
// ChatSkeleton é eager (não lazy) — precisa estar disponível no instante
// em que o chunk de ChatWhatsApp começa a ser baixado.
import { ChatSkeleton } from "@/modules/communication/components/chat/ChatSkeleton";
import { VoiceCallButton, VoiceCallProvider } from "@/modules/communication";
import { LeadCallActionProvider, type LeadCallActionRenderer } from "@/shared/components/LeadCallActionSlot";
const Upsell = lazy(() => lazyRetry(() => import("@/modules/carteira/pages/Upsell")));
const ClienteDetail = lazy(() => lazyRetry(() => import("@/modules/carteira/components/client/ClienteDetailPage")));
// CustomPipeline saiu das rotas (redirect → /funil/:slug, SCRUM-632); o
// arquivo segue no repo até a demolição (SCRUM-637).
// SCRUM-632 (F4, expand-contract): a página ÚNICA de funil. Convive com as 4
// páginas antigas atrás das rotas até a paridade fechar (morrem na SCRUM-637).
const Funil = lazy(() => lazyRetry(() => import("@/modules/pipelines/pages/Funil")));
const Agenda = lazy(() => lazyRetry(() => import("@/modules/engagement/pages/Agenda")));
const Privacidade = lazy(() => lazyRetry(() => import("@/modules/platform/pages/Privacidade")));
const Faq = lazy(() => lazyRetry(() => import("@/modules/platform/pages/Faq")));
// Área do Gestor (ADR-0021) — hub do Gestor de Portfólio + página master de gestores.
const AreaGestor = lazy(() => lazyRetry(() => import("@/modules/identity/gestor/pages/AreaGestor")));
const MasterGestores = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterGestores")));
const CopilotPlayground = lazy(() => lazyRetry(() => import("@/modules/copilot/components/playground").then(m => ({ default: m.CopilotPlayground }))));
const ChecklistPage = lazy(() => lazyRetry(() => import("@/modules/engagement/pages/ChecklistPage")));
const MessageTemplates = lazy(() => lazyRetry(() => import("@/modules/communication/pages/MessageTemplates")));
const Automacoes = lazy(() => lazyRetry(() => import("./modules/workflows/pages/Automacoes")));
const AutomacoesEditor = lazy(() => lazyRetry(() => import("./modules/workflows/pages/AutomacoesEditor")));
const AutomacoesExecucoes = lazy(() => lazyRetry(() => import("./modules/workflows/pages/AutomacoesExecucoes")));


const NotFound = lazy(() => lazyRetry(() => import("@/modules/platform/pages/NotFound")));
const Landing = lazy(() => lazyRetry(() => import("@/modules/marketing/pages/Landing")));
// #1223 — página de calibração da escala tipográfica da TV. Instrumento de
// medição com valores estáticos, não tela de produto: sem auth e sem dado, para
// que a escala possa ser julgada na parede sem depender de sessão ou seed.
// Removível quando #1218–#1221 fecharem.
const TvTypeScale = lazy(() => lazyRetry(() => import("@/modules/analytics/pages/TvTypeScale")));
const Signup = lazy(() => lazyRetry(() => import("@/modules/identity/pages/Signup")));
const ResetPassword = lazy(() => lazyRetry(() => import("@/modules/identity/pages/ResetPassword")));
const MfaSetup = lazy(() => lazyRetry(() => import("@/modules/identity/pages/MfaSetup")));

// Master Admin — lazy loaded (com retry)
const MasterDashboard = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterDashboard")));
const MasterOrganizations = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterOrganizations")));
const MasterUsers = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterUsers")));
// Usuários ativos por org — quem deu sinal de uso (auth.sessions), master-only
const MasterUsuariosAtivos = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterUsuariosAtivos")));
const MasterPlans = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterPlans")));
const MasterPaymentLinks = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterPaymentLinks")));
const MasterFeatures = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterFeatures")));
const MasterAuditLogs = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterAuditLogs")));
const MasterOperations = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterOperations")));
const MasterSupportTickets = lazy(() => lazyRetry(() => import("@/modules/identity/master/pages/MasterSupportTickets")));
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
import { SupportPanelProvider } from "@/modules/platform/components/support/SupportPanelProvider";
import { FloatingDockProvider } from "@/modules/platform/components/dock/FloatingDock";
import { SupportPanel } from "@/modules/platform/components/support/SupportPanel";
import { SupportAnnouncement } from "@/modules/platform/components/support/SupportAnnouncement";

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
          <MainLayout>{children}</MainLayout>
        </SubscriptionProtectedRoute>
      </OnboardingGate>
    </OrgFeaturesProvider>
  );
}

// Root route: boot gate. Ordem master → gestor → membro (ADR-0021 §5).
// Master mantém o app (/dashboard); Gestor de Portfólio ativo entra na Área do
// Gestor (/gestor); membro comum entra no app. Sem usuário → Landing.
function RootRedirect() {
  const { user, loading } = useAuth();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { isGestor, isLoading: gestorLoading } = useGestor();

  const decision = resolveBootRedirect({
    authLoading: loading,
    hasUser: !!user,
    gateLoading: !!user && (masterLoading || gestorLoading),
    isMaster,
    isGestor,
  });

  if (decision.kind === "loading") return null;
  if (decision.kind === "landing") return <Landing />;
  return <Navigate to={decision.to} replace />;
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
      {/* MFA (TOTP) — FORA do gate de master de propósito. Exige apenas sessão
          autenticada: nem master, nem org, nem aal2. Se ficasse atrás do
          MasterRoute (que exige aal2) o master sem fator nunca conseguiria
          cadastrar o primeiro — deadlock. requireOrganization={false} porque
          há masters sem team_member (entram só pelo master). */}
      <Route
        path="/seguranca/mfa"
        element={
          <ProtectedRoute requireOrganization={false}>
            <MfaSetup />
          </ProtectedRoute>
        }
      />
      <Route path="/privacidade" element={<Privacidade />} />
      {/* #1223 — calibração da escala tipográfica da TV. Pública de propósito:
          é instrumento de medição com valores fictícios, não expõe dado algum. */}
      <Route path="/tv-type-scale" element={<TvTypeScale />} />
      {/* #1218 — demo dos renderers (barra/linha/donut) com fixtures. Pública e
          dev-only (a página nega em produção): AID DE QA para validar leitura a
          3m sem sessão de banco. Remover antes do merge (ou o Cais decide). */}
      <Route path="/tv-renderers-demo" element={<TvRenderersDemo />} />
      {/* #1254 acabamento — HARNESS DE PIXEL: a TVComposableWall REAL montada com
          snapshot-fixture (grid+WidgetFrame+buildEyebrow reais). Dev-only (nega em
          prod). Prova os 3 defeitos de parede que as demos de renderer perdiam. */}
      <Route path="/tv-wall-preview" element={<TvWallPreview />} />
      {/* Área do Gestor (ADR-0021 §5): hub do Gestor de Portfólio. GestorRoute
          nega não-gestor; requireOrganization=false porque o Gestor não tem
          team_member/org ao chegar no hub. */}
      <Route
        path="/gestor"
        element={
          <ProtectedRoute requireOrganization={false}>
            <GestorRoute>
              <AreaGestor />
            </GestorRoute>
          </ProtectedRoute>
        }
      />
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
      {/* SCRUM-11 / SCRUM-430 — Estúdio de Métricas.
          O gate ficou de fora até agora porque `useFeaturePermission` é
          fail-closed (`features?.[key] === true`): gatear numa chave que a
          `get-member-permissions` não semeia trancaria todo membro não-admin.
          `metrics.view` entrou no catálogo pela migration 20270828000000, que é
          PRÉ-REQUISITO deste gate — aplicada em prod antes deste código subir.
          Se um dia a chave sair do catálogo, TIRE ESTE GATE PRIMEIRO: é o bug
          vivo de `checklists.view` (SCRUM-431). */}
      <Route
        path="/metricas"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="metrics.view">
                <MetricsStudio />
              </PermissionProtectedRoute>
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
      {/* /turbo — Turbo é grupo da lateral (Copilot + Automações), não tela.
          A lateral NÃO navega mais pra cá: o item é `expandOnly`, só abre o
          grupo. Esta rota fica de rede pra link antigo e bookmark.
          Vai pra Automações porque é o que "Turbo" nomeia no produto.

          ⚠️ Não devolva a navegação ao item pai sem antes envolver esta rota
          num LayoutWrapper. Sendo um <Navigate> nu, entrar aqui desmonta
          MainLayout > Sidebar e zera o estado de expansão — era exatamente
          assim que o submenu fechava no mesmo frame em que abria, deixando o
          "Copilot" inalcançável no desktop. */}
      <Route
        path="/turbo"
        element={<Navigate to="/automacoes" replace />}
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
      <Route path="/pipe-confirmacao" element={<RedirectPipeParaFunil slug="confirmacao" />} />
      <Route path="/pipe-propostas" element={<RedirectPipeParaFunil slug="propostas" />} />
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
      <Route path="/pipe-whatsapp" element={<RedirectPipeParaFunil slug="whatsapp" />} />
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
      {/* Rota própria só para as três de uso diário — `/configuracoes/tags`,
          `/configuracoes/notificacoes`, `/configuracoes/whatsapp` — mais
          `/configuracoes/outros`, que guarda o resto e troca de aba por `?tab=`.
          Um `:tab` só: a página resolve o segmento e normaliza o que não
          reconhece. Mesmo gate da tela-mãe. */}
      <Route
        path="/configuracoes/:tab"
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
      {/* Oráculo Comercial — endereço próprio (SCRUM-594). O recorte de quem
          alcança o quê é do servidor: a tela não filtra nada. */}
      <Route
        path="/oraculo"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <Oraculo />
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
      {/* /chat — alias legado consolidado em /chat-whatsapp (canônico: deep-links
          ?phone/?instance, sidebar, prefetch/skeleton).

          ⚠️ `to` PRECISA repassar a query string. `<Navigate to="/chat-whatsapp">`
          sem ela descartava TODOS os params, e isso quebrava em silêncio todo
          deep-link que passasse por aqui: o `?lead=` da carteira nunca chegava
          ao ChatShell, e o seletor de Conversa do Lead abria na caixa errada
          porque `?instance=` era comido no caminho. Achado só rodando o app
          (validação ponta a ponta do mapa #1605) — nenhum teste de unidade vê
          um redirect de rota. */}
      <Route path="/chat" element={<NavigateComQuery to="/chat-whatsapp" />} />
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
      {/* SCRUM-632 — rota ÚNICA de funil (F4). Aceita slug OU uuid; serve
          qualquer funil pela via canônica (get_pipeline_page por pipeline_id).
          As 3 rotas /pipe-* seguem nas páginas antigas até a paridade de
          sistema (633/634) — mas /funil/whatsapp já funciona p/ A/B manual. */}
      <Route
        path="/funil/:slug"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="pipeline.view">
                <FeatureRoute feature="funnels"><Funil /></FeatureRoute>
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
      {/* Rota antiga do funil custom — redirect permanente pra página nova.
          A página CustomPipeline.tsx segue no repo (morre na SCRUM-637). */}
      <Route path="/pipe/custom/:slug" element={<RedirectPipeCustomParaFunil />} />
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
        <Route path="payment-links" element={<MasterPaymentLinks />} />
        <Route path="features" element={<MasterFeatures />} />
        <Route path="audit-logs" element={<MasterAuditLogs />} />
        <Route path="operations" element={<MasterOperations />} />
        <Route path="gestores" element={<MasterGestores />} />
        <Route path="automation-health" element={<MasterAutomationHealth />} />
        <Route path="whatsapp-health" element={<MasterWhatsAppHealth />} />
        <Route path="copilot-reasoning" element={<CopilotReasoning />} />
        <Route path="copilot-toggle-audit" element={<CopilotToggleAudit />} />
        <Route path="onboarding" element={<MasterOnboarding />} />
        <Route path="meta-assets" element={<MasterMetaAssets />} />
        <Route path="support-tickets" element={<MasterSupportTickets />} />
        <Route path="stage-roles" element={<MasterStageRoleReview />} />
        <Route path="usuarios-ativos" element={<MasterUsuariosAtivos />} />
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

/**
 * `NavigateComQuery` — redirect que PRESERVA a query string.
 *
 * `<Navigate to="/x" />` descarta `?a=b`. Num alias de rota isso quebra todo
 * deep-link em silêncio: nenhum erro aparece, a tela só abre sem contexto.
 * Foi assim que `?lead=` da carteira e `?instance=` do seletor de Conversa do
 * Lead morriam antes de chegar ao ChatShell (mapa #1605).
 */
function NavigateComQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

/**
 * `/pipe/custom/:slug` → `/funil/:slug` (SCRUM-632, expand-contract).
 *
 * O funil custom é o primeiro a usar a página unificada — é upgrade de
 * paridade (ganha paginação real por coluna). Preserva query/hash pelo mesmo
 * motivo de `NavigateComQuery`. A navegação interna já aponta direto para
 * `/funil/…`; este redirect segura bookmark e link antigo.
 */
/**
 * SCRUM-637 — flip das rotas de sistema: /pipe-* viraram redirects pra rota
 * única `/funil/:slug`, preservando query (?view=...) e hash. As 3 páginas
 * velhas morreram no mesmo diff; bookmark e link antigo caem aqui.
 */
function RedirectPipeParaFunil({ slug }: { slug: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`/funil/${slug}${search}${hash}`} replace />;
}

function RedirectPipeCustomParaFunil() {
  const { slug } = useParams<{ slug: string }>();
  const { search, hash } = useLocation();
  return <Navigate to={`/funil/${slug}${search}${hash}`} replace />;
}


/**
 * Vê o lead → pode ligar. O botão some sozinho sem número de voz ao alcance; a
 * única condição sobre o lead é ele estar na tela. Constante de módulo para a
 * identidade não mudar a cada render da raiz.
 */
const renderLeadCallAction: LeadCallActionRenderer = (lead) => (
  <VoiceCallButton variant="icon" leadId={lead.id} leadName={lead.nome} />
);

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
                {/* PilhaDeCartoes usa useNavigate() para abrir o link do
                    cartão, então PRECISA ficar dentro do BrowserRouter.
                    Montado fora, o hook lança no primeiro render e derruba a
                    árvore inteira: tela branca em todas as rotas, para todos
                    os usuários. Foi exatamente o que quebrou a produção. */}
                <PilhaDeCartoes />
                <RealtimeOrgBridge>
                  <PipeOpsProvider>
                    <GlobalErrorBoundary>
                      <PushPermissionPrompt />
                      {/* SupportPanelProvider envolve o palette: a ação
                          "Abrir chamado" do Cmd+K abre este painel. */}
                      <FloatingDockProvider>
                        <SupportPanelProvider>
                          <CommandPaletteProvider>
                            <GlobalShortcutsProvider>
                              {/* VoiceCallProvider por fora das rotas: a chamada
                                  sobrevive à navegação e ao fechamento do modal
                                  do lead que a originou. */}
                              <VoiceCallProvider>
                                {/* O botão de ligar dos cards de `leads` é
                                    injetado daqui: `leads` não pode importar
                                    `communication` sem fechar ciclo entre os
                                    dois módulos. Ver LeadCallActionSlot. */}
                                <LeadCallActionProvider value={renderLeadCallAction}>
                                  <AppRoutes />
                                  <CommandPaletteComponent />
                                  <SupportPanel />
                                  <SupportAnnouncement />
                                </LeadCallActionProvider>
                              </VoiceCallProvider>
                            </GlobalShortcutsProvider>
                          </CommandPaletteProvider>
                        </SupportPanelProvider>
                      </FloatingDockProvider>
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