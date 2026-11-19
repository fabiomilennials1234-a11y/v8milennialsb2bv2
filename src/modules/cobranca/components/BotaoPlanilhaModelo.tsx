/**
 * "Baixar planilha modelo" — o .xlsx com as colunas que a importação entende,
 * obrigatórias e opcionais marcadas. Usado no cadastro de novo inadimplente e
 * no passo 1 da importação.
 */
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { notifyError } from "@/shared/errors";

import { baixarPlanilhaModelo } from "../lib/planilha-modelo";

export function BotaoPlanilhaModelo({ dica = true }: { /** Texto auxiliar ao lado do botão. */ dica?: boolean }) {
  const [baixando, setBaixando] = useState(false);

  const baixar = async () => {
    setBaixando(true);
    try {
      await baixarPlanilhaModelo();
    } catch (err) {
      notifyError(err, { fallback: "Não foi possível gerar a planilha modelo.", context: { feature: "cobranca" } });
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" variant="outline" size="sm" onClick={() => void baixar()} disabled={baixando}>
        {baixando ? <Loader2 className="animate-spin" /> : <Download />}
        Baixar planilha modelo
      </Button>
      {dica && (
        <span className="text-xs text-muted-foreground">
          Para cadastrar vários de uma vez: baixe, preencha e use Importar planilha.
        </span>
      )}
    </div>
  );
}
