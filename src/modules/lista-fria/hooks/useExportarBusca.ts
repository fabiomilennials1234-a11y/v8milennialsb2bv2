import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

import { montarCsv, nomeDoArquivo } from "../lib/csv";
import { type Resultado, parseResultado } from "../lib/tipos";

/** O PostgREST devolve no máximo 1000 linhas por chamada: pagina até acabar. */
const PAGINA = 1000;
const MAX_PAGINAS = 50;

/** Baixa TODOS os resultados da busca em CSV, não só a página que está na tela. */
export function useExportarBusca() {
  const { organizationId } = useOrganization();
  return useMutation({
    mutationFn: async (v: { buscaId: string; titulo: string }) => {
      const todas: Resultado[] = [];
      for (let p = 0; p < MAX_PAGINAS; p++) {
        const { data, error } = await supabase
          .from("lista_fria_resultados")
          .select("*")
          .eq("organization_id", organizationId as string)
          .eq("busca_id", v.buscaId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(p * PAGINA, p * PAGINA + PAGINA - 1);
        if (error) throw error;
        const linhas = data ?? [];
        todas.push(...linhas.map(parseResultado));
        if (linhas.length < PAGINA) break;
      }
      const blob = new Blob([montarCsv(todas)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeDoArquivo(v.titulo);
      a.click();
      URL.revokeObjectURL(url);
      return todas.length;
    },
  });
}
