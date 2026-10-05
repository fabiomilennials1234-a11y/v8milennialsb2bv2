/** Dia civil da venda no fuso configurado pela organização. */
export const diaDaVenda = (iso: string, timezone = "America/Sao_Paulo") =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone });
