import { useEffect, useState } from "react";

import { LeadCard } from "@/modules/leads/components/lead-card/LeadCard";
import {
  LEAD_EXEMPLO,
  LEAD_EXEMPLO_MAGRO,
} from "@/modules/leads/components/lead-card/fixtures";
import { DealCard } from "@/modules/leads/components/deal-card/DealCard";
import {
  NEGOCIO_ESTAGNADO,
  NEGOCIO_MAGRO,
  NEGOCIO_GANHO,
} from "@/modules/leads/components/deal-card/fixtures";

/**
 * Casca da visualização — alterna entre os dois exemplos e entre claro e
 * escuro. Só existe para o desenho ser julgado nos dois estados que importam:
 * o cliente cheio de história e o lead novo, que é 94% da base.
 */

/**
 * Os dois cards do Torque, lado a lado nos exemplos que a medição diz serem os
 * reais — e não nos bonitos. O card precisa ser bom no caso majoritário, que é
 * quase sempre o mais vazio.
 */
const EXEMPLOS = [
  { chave: "lead-cliente", grupo: "Lead", rotulo: "Cliente que voltou", dado: LEAD_EXEMPLO },
  { chave: "lead-magro", grupo: "Lead", rotulo: "Lead novo (94% da base)", dado: LEAD_EXEMPLO_MAGRO },
  { chave: "neg-estagnado", grupo: "Negócio", rotulo: "Parado (57% do pipeline)", dado: NEGOCIO_ESTAGNADO },
  { chave: "neg-magro", grupo: "Negócio", rotulo: "Sem valor (98,9%)", dado: NEGOCIO_MAGRO },
  { chave: "neg-ganho", grupo: "Negócio", rotulo: "Ganho", dado: NEGOCIO_GANHO },
] as const;

export function Preview() {
  const [escuro, setEscuro] = useState(true);
  const [qual, setQual] = useState<(typeof EXEMPLOS)[number]["chave"]>("lead-cliente");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", escuro);
  }, [escuro]);

  const atual = EXEMPLOS.find((e) => e.chave === qual)!;

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {EXEMPLOS.map((e, i) => (
              <div key={e.chave} className="flex items-center gap-2">
                {(i === 0 || EXEMPLOS[i - 1].grupo !== e.grupo) && (
                  <span className="ml-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                    {e.grupo}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setQual(e.chave)}
                  className={
                    "rounded-lg border px-3 py-1.5 text-[13px] transition-colors " +
                    (qual === e.chave
                      ? "border-primary/45 bg-primary/10 font-medium text-primary"
                      : "border-border bg-card text-muted-foreground hover:text-foreground")
                  }
                >
                  {e.rotulo}
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setEscuro((v) => !v)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {escuro ? "Ver no claro" : "Ver no escuro"}
          </button>
        </div>

        <div className="h-[calc(100vh-124px)] min-h-[620px] overflow-hidden rounded-xl shadow-2xl">
          {atual.grupo === "Lead" ? (
            <LeadCard lead={atual.dado as Parameters<typeof LeadCard>[0]["lead"]} />
          ) : (
            <DealCard negocio={atual.dado as Parameters<typeof DealCard>[0]["negocio"]} />
          )}
        </div>
      </div>
    </div>
  );
}
