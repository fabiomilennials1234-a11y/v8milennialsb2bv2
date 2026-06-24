/**
 * ProductTour — tour guiado (intro.js) das funcionalidades da Central de Comando.
 *
 * - Auto-inicia uma única vez, no primeiro acesso (desktop, rota /dashboard).
 * - Pode ser reaberto a qualquer momento disparando o evento `v8:start-tour`
 *   (ver botão "Ver tour" no menu do usuário em TopNavigation).
 *
 * Renderize uma única instância dentro do MainLayout.
 */
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import introJs from "intro.js";
import { useViewport } from "@/hooks/use-viewport";
import { useTourState } from "./useTourState";
import { dashboardTour } from "./tourSteps";
import "./introjs-theme.css";

const DASHBOARD_PATH = "/dashboard";
export const TOUR_START_EVENT = "v8:start-tour";

export function ProductTour() {
  const { hasSeen, isLoading, markSeen } = useTourState();
  const { isMobile } = useViewport();
  const location = useLocation();
  const navigate = useNavigate();

  const tourRef = useRef<ReturnType<typeof introJs> | null>(null);
  const autoStartedRef = useRef(false);

  const launch = useCallback(() => {
    if (tourRef.current) return; // já em execução
    const tour = introJs();
    tour.setOptions({
      steps: dashboardTour,
      nextLabel: "Próximo →",
      prevLabel: "← Voltar",
      doneLabel: "Começar a usar 🚀",
      skipLabel: "✕",
      showProgress: true,
      showBullets: false,
      exitOnOverlayClick: false,
      scrollToElement: true,
      overlayOpacity: 0.55,
    });
    const finish = () => {
      markSeen();
      tourRef.current = null;
    };
    tour.oncomplete(finish);
    tour.onexit(finish);
    tourRef.current = tour;
    tour.start();
  }, [markSeen]);

  /** Garante estar no /dashboard antes de iniciar (os anchors vivem lá). */
  const startOnDashboard = useCallback(() => {
    const delay = location.pathname === DASHBOARD_PATH ? 500 : 900;
    if (location.pathname !== DASHBOARD_PATH) navigate(DASHBOARD_PATH);
    window.setTimeout(launch, delay);
  }, [location.pathname, navigate, launch]);

  // Reabrir via evento (botão "Ver tour"). Ignora "já viu".
  useEffect(() => {
    const handler = () => startOnDashboard();
    window.addEventListener(TOUR_START_EVENT, handler);
    return () => window.removeEventListener(TOUR_START_EVENT, handler);
  }, [startOnDashboard]);

  // Auto-start no primeiro acesso (desktop, no dashboard).
  useEffect(() => {
    if (isLoading || hasSeen || isMobile) return;
    if (location.pathname !== DASHBOARD_PATH) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    const t = window.setTimeout(launch, 800);
    return () => window.clearTimeout(t);
  }, [isLoading, hasSeen, isMobile, location.pathname, launch]);

  // Limpa o overlay se o componente desmontar com o tour aberto.
  useEffect(
    () => () => {
      tourRef.current?.exit(true);
      tourRef.current = null;
    },
    [],
  );

  return null;
}
