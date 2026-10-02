/**
 * Routes shot by shoot.mjs. `name` becomes the file name. `master: true`
 * routes only render when the mock runs with --master (they are skipped
 * otherwise). Ids come from fixtures/seed.mjs (`id(kind, n)`).
 */
import { id, buildFixtures } from "./fixtures/seed.mjs";

const fx = buildFixtures();
const firstThread = fx.db.whatsapp_messages[0];

// V5 (CTO, 02/10): sete abas com rota própria; as antigas viraram seções.
const settingsTabs = ["integracoes", "assinatura", "api-webhooks", "geral"];

export const ROUTES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "metricas", path: "/metricas" },
  { name: "chat-whatsapp", path: "/chat-whatsapp" },
  { name: "chat-whatsapp-open", path: `/chat-whatsapp?instance=${firstThread.instance_id}&phone=${firstThread.phone_number}`, fullReload: true },
  { name: "atendimento-meta", path: "/atendimento/meta" },
  { name: "disparos", path: "/disparos" },
  { name: "disparos-novo", path: "/disparos/novo" },
  { name: "funis", path: "/funis" },
  { name: "funil-vendas", path: "/funil/vendas" },
  { name: "funil-prospeccao", path: "/funil/prospeccao" },
  { name: "funil-recompra", path: "/funil/recompra" },
  { name: "leads", path: "/leads" },
  { name: "lixeira", path: "/lixeira" },
  { name: "duplicatas", path: "/duplicatas" },
  { name: "copilot", path: "/copilot" },
  { name: "copilot-metricas", path: "/copilot/metricas" },
  { name: "copilot-novo", path: "/copilot/novo" },
  { name: "copilot-editar", path: `/copilot/${id("agent", 1)}/editar` },
  { name: "oraculo", path: "/oraculo" },
  { name: "automacoes", path: "/automacoes" },
  { name: "automacoes-editor", path: `/automacoes/${id("wf", 1)}` },
  { name: "automacoes-novo", path: "/automacoes/novo" },
  { name: "automacoes-execucoes", path: `/automacoes/${id("wf", 1)}/execucoes` },
  { name: "agenda", path: "/agenda" },
  { name: "follow-ups", path: "/follow-ups" },
  { name: "checklists", path: "/checklists" },
  { name: "performance", path: "/performance" },
  { name: "comissoes", path: "/comissoes" },
  { name: "upsell", path: "/upsell" },
  { name: "carteira-cliente", path: `/carteira/${id("client", 1)}` },
  { name: "produtos", path: "/produtos" },
  { name: "templates", path: "/templates" },
  { name: "equipe", path: "/equipe" },
  { name: "configuracoes", path: "/configuracoes" },
  { name: "config-tags", path: "/configuracoes/tags" },
  { name: "config-notificacoes", path: "/configuracoes/notificacoes" },
  { name: "config-whatsapp", path: "/configuracoes/whatsapp" },
  ...settingsTabs.map((t) => ({ name: `config-${t}`, path: `/configuracoes/${t}` })),
  { name: "faq", path: "/faq" },
  { name: "pitstop", path: "/pitstop" },
  { name: "tv", path: "/tv", fullReload: true },
  { name: "master", path: "/master", master: true },
  { name: "master-organizations", path: "/master/organizations", master: true },
  { name: "master-users", path: "/master/users", master: true },
  { name: "master-plans", path: "/master/plans", master: true },
  { name: "master-features", path: "/master/features", master: true },
  { name: "master-support-tickets", path: "/master/support-tickets", master: true },
  { name: "insights", path: "/insights", master: true },
];
