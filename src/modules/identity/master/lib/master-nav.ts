/**
 * As 5 centrais da Área Dev e quem vê cada item (regra PE-4). Configuração
 * pura — o `MasterSidebar` desenha, este arquivo decide.
 */

export interface NavItem {
  label: string;
  path: string;
  /**
   * Basta UMA destas chaves (ou `all`). Sem chave, o item é de todo master —
   * hoje só o Panorama, que era o Dashboard.
   */
  permission?: readonly string[];
  /**
   * Item exige master PLENO (`permissions.all`). Usar em telas que expõem
   * dados de TODOS os clientes — o outbounder tem linha em master_users mas
   * é perfil restrito e não pode ver a frota inteira.
   */
  requiresFullMaster?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** As 18 telas antigas, cada uma na sua central. Só rótulo, sem ícone. */
export const MASTER_GROUPS: NavGroup[] = [
  {
    label: "Operação",
    items: [{ label: "Chamados", path: "/master/operacao", permission: ["operacao", "support"] }],
  },
  {
    label: "Implementação",
    items: [
      { label: "Implantações", path: "/master/implementacao", permission: ["implementacao", "features"] },
      { label: "Templates", path: "/master/onboarding", permission: ["implementacao", "features"] },
      { label: "Etapas Won/Lost", path: "/master/stage-roles", permission: ["implementacao", "audit"] },
    ],
  },
  {
    label: "Organizações",
    items: [
      { label: "Organizações", path: "/master/organizations", permission: ["organizacoes", "organizations"] },
      { label: "Panorama", path: "/master/panorama" },
      { label: "Usuários", path: "/master/users", permission: ["organizacoes", "users"] },
      { label: "Usuários ativos", path: "/master/usuarios-ativos", permission: ["organizacoes", "users"], requiresFullMaster: true },
      { label: "Gestores", path: "/master/gestores", permission: ["organizacoes", "gestores"] },
      { label: "Planos", path: "/master/plans", permission: ["organizacoes", "billing"] },
      { label: "Features", path: "/master/features", permission: ["organizacoes", "features"] },
    ],
  },
  {
    label: "Monitoramento",
    items: [
      { label: "Incidentes", path: "/master/monitoramento", permission: ["monitoramento", "audit"] },
      { label: "Automações", path: "/master/automation-health", permission: ["monitoramento", "audit"] },
      { label: "WhatsApp", path: "/master/whatsapp-health", permission: ["monitoramento", "audit"] },
      { label: "Operations", path: "/master/operations", permission: ["monitoramento", "audit"] },
      { label: "Ativos da Meta", path: "/master/meta-assets", permission: ["monitoramento", "features"] },
      { label: "Auditoria", path: "/master/audit-logs", permission: ["monitoramento", "audit"] },
    ],
  },
  {
    label: "Testes",
    items: [
      { label: "Avaliações", path: "/master/testes", permission: ["testes", "audit"] },
      { label: "Qualidade do Oráculo", path: "/master/oraculo-feedback", permission: ["testes", "audit"], requiresFullMaster: true },
      { label: "Raciocínio do copilot", path: "/master/copilot-reasoning", permission: ["testes", "audit"] },
      { label: "Liga e desliga IA", path: "/master/copilot-toggle-audit", permission: ["testes", "audit"] },
    ],
  },
];

/** Pode este master ver o item? Exportada para o teste travar a regra PE-4. */
export function canSeeNavItem(item: NavItem, permissions: Record<string, unknown>): boolean {
  // Itens de frota inteira: só master pleno. Checado ANTES do resto, senão
  // o outbounder passaria por uma chave que ele possui.
  if (item.requiresFullMaster && permissions.all !== true) return false;
  if (!item.permission) return true;
  if (permissions.all === true) return true;
  return item.permission.some((k) => permissions[k] === true);
}
