/**
 * mock-disparo-data — placeholder structured data for the Wizard Linear shell (#904).
 *
 * The #904 deliverable is the *navigable shell*. The real data sources land in
 * sibling slices:
 *   - audiences (segments/funnel stages/tags)  → TODO(#902) audience builder
 *                                                 TODO(#906) saved segments
 *   - WhatsApp numbers + per-number daily caps  → TODO(#908) real instances
 *
 * Shapes here mirror the real domain types so the steps and the pure
 * `wizard-machine` need no change when the real sources are wired — only the
 * provider swaps. Realistic B2B values so the flow reads true end-to-end.
 */
import type { DisparoNumber } from "./wizard-machine";
import type { PreviewSample } from "./message-preview";

export interface MockAudience {
  id: string;
  label: string;
  detail: string;
  count: number;
}

/** TODO(#902/#906): replace with the real audience builder + saved segments. */
export const MOCK_AUDIENCES: MockAudience[] = [
  {
    id: "funnel-novo",
    label: "Funil WhatsApp · Novo lead",
    detail: "Contatos parados no primeiro estágio",
    count: 1240,
  },
  {
    id: "funnel-sem-resposta",
    label: "Funil WhatsApp · Sem resposta há 7 dias",
    detail: "Leads abordados que não responderam",
    count: 486,
  },
  {
    id: "tag-ouro",
    label: "Tag: Ouro",
    detail: "Contas de maior faturamento",
    count: 96,
  },
  {
    id: "carteira-frio",
    label: "Carteira · Sem compra há 60 dias",
    detail: "Clientes em risco de churn",
    count: 312,
  },
];

/**
 * Sample Leads for the message preview (#907) — the operator cycles through
 * these to see the message as different real contacts will receive it.
 * TODO(#902): draw real samples from the resolved audience.
 */
export const MOCK_PREVIEW_SAMPLES: PreviewSample[] = [
  { nome: "João da Silva", empresa: "Petshop Amigo Fiel", segmento: "Petshop" },
  { nome: "Marina Costa", empresa: "Distribuidora Norte", segmento: "Atacado" },
  { nome: "Roberto Lima", empresa: "AgroForte Insumos", segmento: "Agro" },
];

/**
 * Mock instances. The per-number cap starts at the recommended value and is
 * re-derived by the Velocidade slider; a `new` number is auto-clamped.
 * TODO(#910): replace with the org's real connected WhatsApp instances.
 */
export const MOCK_NUMBERS: DisparoNumber[] = [
  { id: "inst-comercial-1", label: "Comercial 1", cap: 80, selected: true },
  { id: "inst-comercial-2", label: "Comercial 2", cap: 80, selected: true },
  { id: "inst-novo-sdr", label: "Novo SDR", cap: 20, selected: false, isNew: true },
];
