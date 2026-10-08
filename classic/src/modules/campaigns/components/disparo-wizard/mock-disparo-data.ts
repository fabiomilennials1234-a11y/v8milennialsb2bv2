/**
 * mock-disparo-data — illustrative preview samples for the message step.
 *
 * The audience (#902) and the WhatsApp numbers (#908) are now wired to real
 * sources. What remains here are the message-preview personas: the operator
 * cycles them to spot-check how variables resolve. They are intentionally
 * illustrative (no PII, no extra query); drawing real samples from the resolved
 * audience is a later refinement — TODO(#907 real samples).
 */
import type { PreviewSample } from "./message-preview";

export const MOCK_PREVIEW_SAMPLES: PreviewSample[] = [
  { nome: "João da Silva", empresa: "Petshop Amigo Fiel", segmento: "Petshop" },
  { nome: "Marina Costa", empresa: "Distribuidora Norte", segmento: "Atacado" },
  { nome: "Roberto Lima", empresa: "AgroForte Insumos", segmento: "Agro" },
];
