/**
 * Puro: endereço do crm-mcp, instruções de conexão por cliente de IA e estado de um token
 * pessoal (crm-mcp, ADR 0012). Fora do componente para ter teste sem render.
 *
 * Os clientes cobertos são os que aceitam um servidor MCP remoto com cabeçalho
 * `Authorization` fixo. Conector do claude.ai web e do ChatGPT exige OAuth — fase seguinte
 * (DESIGN §9, C6) — e por isso não aparece aqui.
 */

export const MCP_SERVER_NAME = "torque-crm";

export function mcpEndpoint(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/crm-mcp`;
}

export type McpClient = "claude-code" | "cursor" | "claude-desktop";

export const MCP_CLIENTS: ReadonlyArray<{ id: McpClient; label: string; hint: string }> = [
  { id: "claude-code", label: "Claude Code", hint: "Cole no terminal." },
  { id: "cursor", label: "Cursor e outros", hint: "Arquivo .cursor/mcp.json (ou o mcp.json do seu cliente)." },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    hint: "Em Configurações › Desenvolvedor › Editar configuração. Precisa do Node.js instalado.",
  },
];

/** O que colar em cada cliente. O token vai inteiro — a tela só mostra isto uma vez. */
export function connectionSnippet(client: McpClient, endpoint: string, token: string): string {
  switch (client) {
    case "claude-code":
      return `claude mcp add --transport http ${MCP_SERVER_NAME} ${endpoint} --header "Authorization: Bearer ${token}"`;
    case "cursor":
      return JSON.stringify(
        { mcpServers: { [MCP_SERVER_NAME]: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      );
    case "claude-desktop":
      // O Desktop só fala stdio; o mcp-remote faz a ponte para HTTP com o cabeçalho.
      return JSON.stringify(
        {
          mcpServers: {
            [MCP_SERVER_NAME]: {
              command: "npx",
              args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${token}`],
            },
          },
        },
        null,
        2,
      );
  }
}

export interface TokenLike {
  expires_at: string;
  revoked_at: string | null;
}

export type TokenState = "active" | "expired" | "revoked";

export function tokenState(t: TokenLike, nowMs: number): TokenState {
  if (t.revoked_at) return "revoked";
  return Date.parse(t.expires_at) <= nowMs ? "expired" : "active";
}

/** Dias inteiros até expirar (0 = expira hoje). Negativo nunca: expirado é estado próprio. */
export function daysLeft(expiresAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - nowMs) / 86_400_000));
}

export const VALIDITY_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
  { days: 180, label: "6 meses" },
  { days: 366, label: "1 ano" },
];

const REVOKE_REASON_LABEL: Record<string, string> = {
  user: "revogado por quem criou",
  admin: "revogado pelo administrador",
  master: "revogado pelo suporte",
  auto_unused: "revogado após 90 dias sem uso",
  offboarding: "revogado ao sair da organização",
  compromise: "revogado por suspeita de vazamento",
};

export function revokeReasonLabel(reason: string | null): string {
  return (reason && REVOKE_REASON_LABEL[reason]) || "revogado";
}
