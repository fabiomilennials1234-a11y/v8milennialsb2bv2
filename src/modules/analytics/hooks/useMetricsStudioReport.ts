import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useOrganization } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import { fetchMetricMeasure } from "./useMetricMeasure";
import { ENGINE_BY_ID } from "@/modules/analytics/lib/metrics-studio-engine-map";
import {
  montarRelatorio,
  nomeDoArquivo,
  REPORT_SCOPE_LABEL,
  type ReportItem,
  type ReportScope,
} from "@/modules/analytics/lib/metrics-studio-report";
import { periodoAnterior, periodoAtual } from "@/modules/analytics/lib/metrics-studio-period";
import type { StudioWindow } from "./useMetricsStudio";

/**
 * Exportação do painel em planilha (SCRUM-312 · G10).
 *
 * `exceljs` entra por `await import()`, nunca por import estático: ele NÃO
 * está em `manualChunks` do vite.config, e só fica fora do bundle inicial
 * porque todos os seis call-sites do repo o carregam sob demanda. Um import
 * estático aqui jogaria a lib inteira no carregamento da aplicação.
 */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function rotuloDoPeriodo(scope: ReportScope, hoje: Date): string {
  if (scope === "month") return `${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}`;
  const tri = Math.floor(hoje.getMonth() / 3) + 1;
  return `${tri}º trimestre de ${hoje.getFullYear()}`;
}

export function useMetricsStudioReport(windows: StudioWindow[]) {
  const { organizationId } = useOrganization();
  const [exportando, setExportando] = useState<ReportScope | null>(null);

  const exportar = useCallback(
    async (scope: ReportScope) => {
      if (!organizationId || exportando) return;
      setExportando(scope);

      try {
        const hoje = new Date();

        // `useOrganization` não expõe o nome da org — expõe id, tipo e fuso.
        // Buscar aqui, no clique, evita alterar um hook de identidade que meio
        // sistema consome só para preencher um cabeçalho de planilha.
        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", organizationId)
          .maybeSingle();
        const orgNome = (org as { name?: string | null } | null)?.name ?? "Organização";

        const studioPeriod = scope === "month" ? "month" : "quarter";
        const atual = periodoAtual(studioPeriod, hoje);
        const anterior = periodoAnterior(studioPeriod, hoje);

        // Uma leitura por janela, atual e anterior. São poucas janelas (teto de
        // 24 no banco) e o clique é deliberado — paralelizar é seguro aqui.
        const itens: ReportItem[] = [];
        await Promise.all(
          windows.map(async (win) => {
            const metric = ENGINE_BY_ID.get(win.metricId);
            if (!metric) return;
            const comum = { organizationId, measureRef: metric.measureRef, filters: metric.filtrosFixos };
            const [medidaAtual, medidaAnterior] = await Promise.all([
              fetchMetricMeasure({ ...comum, recorte: win.corte, ...atual }),
              fetchMetricMeasure({ ...comum, recorte: "total", ...anterior }),
            ]);
            itens.push({ metric, corte: win.corte, atual: medidaAtual, anterior: medidaAnterior });
          }),
        );

        // A ordem do Promise.all não é a ordem do painel — reordena para o
        // relatório sair na sequência que a pessoa vê na tela.
        const ordem = new Map(windows.map((w, i) => [w.metricId + w.corte, i]));
        itens.sort((a, b) => (ordem.get(a.metric.id + a.corte) ?? 0) - (ordem.get(b.metric.id + b.corte) ?? 0));

        const abas = montarRelatorio({
          orgNome,
          scope,
          periodoLabel: rotuloDoPeriodo(scope, hoje),
          geradoEm: hoje,
          itens,
        });

        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        for (const aba of abas) {
          const ws = workbook.addWorksheet(aba.nome);
          aba.linhas.forEach((linha) => ws.addRow(linha));
          ws.getRow(1).font = { bold: true };
          ws.columns.forEach((col) => {
            col.width = 26;
          });
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = nomeDoArquivo(orgNome, scope, hoje);
        a.click();
        URL.revokeObjectURL(url);

        toast.success(`Relatório ${REPORT_SCOPE_LABEL[scope].toLowerCase()} baixado`);
      } catch (e) {
        console.error("[metrics-studio] falha ao exportar", e);
        toast.error("Não foi possível gerar o relatório");
      } finally {
        setExportando(null);
      }
    },
    [organizationId, windows, exportando],
  );

  return { exportar, exportando };
}
