/**
 * Passos do product tour (intro.js).
 *
 * Cada passo referencia um elemento real via seletor `[data-tour="..."]`.
 * Os anchors estão marcados nos componentes:
 *   - dashboard-period  → DashboardHeader (navegação de mês)
 *   - dashboard-kpis     → TabVisaoGeral (grid de KPIs)
 *   - dashboard-gauge    → TabVisaoGeral (velocímetro de meta)
 *   - dashboard-tabs     → Dashboard (TabsList)
 *   - oraculo            → OraculoFloatingButton
 *   - nav-comando        → TopNavigation (link Comando)
 *   - nav-ranking        → TopNavigation (link Ranking)
 *   - nav-mais           → TopNavigation (botão "Mais")
 *
 * Observação: os passos de navegação miram a barra superior, que só fica visível
 * a partir do breakpoint `xl` (≥1280px). O auto-start é restrito a desktop.
 */

export interface TourStep {
  /** Seletor CSS do alvo. Ausente = passo flutuante (centralizado). */
  element?: string;
  title?: string;
  intro: string;
  position?: "top" | "bottom" | "left" | "right" | "floating";
}

/** Tour completo, disparado na rota /dashboard. */
export const dashboardTour: TourStep[] = [
  {
    title: "👋 Bem-vindo ao Torque",
    intro:
      "Esta é a sua <b>Central de Comando</b> — a primeira tela do dia. " +
      "Em ~1 minuto te mostro o essencial. Use <b>← →</b> para navegar.",
  },
  {
    element: '[data-tour="dashboard-period"]',
    title: "🗓️ Seu mês, no controle",
    intro:
      "O panorama é sempre do <b>mês selecionado</b>. Navegue entre períodos por aqui " +
      "para comparar e revisar fechamentos.",
    position: "bottom",
  },
  {
    element: '[data-tour="dashboard-kpis"]',
    title: "📊 O pulso da operação",
    intro:
      "Receita, leads captados, ticket médio, conversão e tempo de resposta. " +
      "Tudo <b>atualiza sozinho</b> conforme sua equipe trabalha.",
    position: "bottom",
  },
  {
    element: '[data-tour="dashboard-gauge"]',
    title: "⚡ Velocímetro da meta",
    intro:
      "Acompanhe o <b>realizado vs. o esperado</b> para o dia do mês e veja, num olhar, " +
      "se está no ritmo de bater a meta.",
    position: "right",
  },
  {
    element: '[data-tour="dashboard-tabs"]',
    title: "🧭 Suas visões",
    intro:
      "Alterne entre <b>Visão Geral</b>, <b>Performance</b> e <b>Inteligência</b> — " +
      "do panorama ao detalhe da operação.",
    position: "bottom",
  },
  {
    element: '[data-tour="oraculo"]',
    title: "🔮 Oráculo Comercial",
    intro:
      "A IA da sua carteira. Pergunte <b>o que fazer hoje</b>, quem está em risco e " +
      "onde está a receita parada — em português, direto ao ponto.",
    position: "left",
  },
  {
    element: '[data-tour="nav-comando"]',
    title: "🏠 Comando",
    intro: "Você sempre volta para a Central de Comando por aqui.",
    position: "bottom",
  },
  {
    element: '[data-tour="nav-ranking"]',
    title: "🏆 Ranking",
    intro: "Desempenho de clientes e pilotos (vendedores) lado a lado.",
    position: "bottom",
  },
  {
    element: '[data-tour="nav-mais"]',
    title: "➕ Tudo o mais",
    intro:
      "Equipe (Pilotos), Combustível (Leads), Templates, Lixeira e mais ficam neste menu. " +
      "Pronto! Você já conhece o essencial. 🚀",
    position: "bottom",
  },
];
