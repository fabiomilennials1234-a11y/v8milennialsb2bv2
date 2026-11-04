/** Onde fica o alvo de uma busca. Sem dependências: `tipos.ts` e `meta.ts` leem daqui, sem ciclo. */
export interface LocalDaBusca {
  /** "São Paulo" — vazio quando a busca não é por cidade. */
  cidade: string | null;
  /** "SP" */
  uf: string | null;
}

export const SEM_LOCAL: LocalDaBusca = { cidade: null, uf: null };

/** "São Paulo - SP" → { cidade: "São Paulo", uf: "SP" }. Sem UF no fim, tudo é cidade. */
export function localDoTextoDeCidade(texto: string | null | undefined): LocalDaBusca {
  const t = (texto ?? "").trim();
  const m = /^(.*?)\s*[-–]\s*([A-Za-z]{2})$/.exec(t);
  if (m && m[1]) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
  return { cidade: t || null, uf: null };
}
