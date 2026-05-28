export type DashboardTab = "resultado" | "time" | "meus-numeros";

export interface DashboardTabConfig {
  id: DashboardTab;
  label: string;
  visible: boolean;
  default: boolean;
}

export interface DashboardTabContext {
  role: "admin" | "member" | null;
  isMaster: boolean;
}

const ALL_TABS: Omit<DashboardTabConfig, "visible" | "default">[] = [
  { id: "resultado", label: "Resultado" },
  { id: "time", label: "Time" },
  { id: "meus-numeros", label: "Meus Números" },
];

export function getDashboardTabs(context: DashboardTabContext): DashboardTabConfig[] {
  const isAdmin = context.isMaster || context.role === "admin";
  const defaultTab = getDefaultTab(context);

  if (context.role === null && !context.isMaster) {
    return ALL_TABS.map((tab) => ({
      ...tab,
      visible: false,
      default: false,
    }));
  }

  return ALL_TABS.map((tab) => ({
    ...tab,
    visible: isAdmin || tab.id === "meus-numeros",
    default: tab.id === defaultTab,
  }));
}

export function getDefaultTab(context: DashboardTabContext): DashboardTab {
  const isAdmin = context.isMaster || context.role === "admin";
  return isAdmin ? "resultado" : "meus-numeros";
}
