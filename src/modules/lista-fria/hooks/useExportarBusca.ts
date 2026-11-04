import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

import { montarCsv, nomeDoArquivo } from "../lib/csv";
import { montarArquivoMeta, nomeDoArquivoMeta } from "../lib/meta";
import { type Busca, type Resultado, parseResultado } from "../lib/tipos";

/** O PostgREST devolve no máximo 1000 linhas por chamada: pagina até acabar. */
const PAGINA = 1000;
const MAX_PAGINAS = 50;

async function lerTodosOsResultados(organizationId: string, buscaId: string): Promise<Resultado[]> {
  const todas: Resultado[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await supabase
      .from("lista_fria_resultados")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("busca_id", buscaId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw error;
    const linhas = data ?? [];
    todas.push(...linhas.map(parseResultado));
    if (linhas.length < PAGINA) break;
  }
  return todas;
}

function baixar(texto: string, nome: string) {
  const blob = new Blob([texto], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** Baixa TODOS os resultados da busca em CSV, não só a página que está na tela. */
export function useExportarBusca() {
  const { organizationId } = useOrganization();
  return useMutation({
    mutationFn: async (v: { buscaId: string; titulo: string }) => {
      const todas = await lerTodosOsResultados(organizationId as string, v.buscaId);
      baixar(montarCsv(todas), nomeDoArquivo(v.titulo));
      return todas.length;
    },
  });
}

/**
 * Baixa os contatos da busca no formato da lista de clientes do Meta (Público Personalizado).
 * Devolve quantas linhas foram para o arquivo e quantos resultados ficaram de fora. Sem nenhuma
 * linha aproveitável, não baixa arquivo vazio.
 */
export function useExportarPublicoMeta() {
  const { organizationId } = useOrganization();
  return useMutation({
    mutationFn: async (busca: Pick<Busca, "id" | "titulo" | "fonte" | "local">) => {
      const todas = await lerTodosOsResultados(organizationId as string, busca.id);
      const arquivo = montarArquivoMeta(todas, busca.fonte, busca.local);
      if (arquivo.linhas > 0) baixar(arquivo.csv, nomeDoArquivoMeta(busca.titulo));
      return { linhas: arquivo.linhas, descartados: arquivo.descartados };
    },
  });
}
