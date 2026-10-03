import type { Tables } from "./types";

/**
 * Contratos temporários da API pública dos hooks de funil.
 *
 * Os consumidores ainda usam o nome `status`; `negocio_projetado` expõe a
 * mesma informação em `stage_key` e as queries aplicam o alias PostgREST.
 */
export type ProjectedSystemPipe = Partial<Tables<"negocio_projetado">> & {
  id: string | null;
  lead_id: string | null;
  organization_id: string | null;
  status: string | null;
};

export type ProjectedWhatsappPipe = ProjectedSystemPipe;
export type ProjectedConfirmacaoPipe = ProjectedSystemPipe;
export type ProjectedPropostaPipe = ProjectedSystemPipe;
