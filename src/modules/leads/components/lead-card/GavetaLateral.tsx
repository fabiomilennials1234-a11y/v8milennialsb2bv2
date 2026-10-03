import type { CSSProperties, ReactNode } from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * A gaveta do V5 — a casca da ficha do lead E do painel do Negócio.
 *
 * No mockup não existem dois painéis: o cartão do funil e a linha da lista
 * abrem a MESMA gaveta à direita (560 px, flutuando 12 px da borda, raio 28,
 * fundo de bancada com cartões brancos). Esta casca é essa gaveta; quem a usa
 * decide só a largura e o que vai dentro.
 *
 * ── POR QUE `DialogContent` NO COMPUTADOR, E NÃO `SheetContent` ───────────
 * Duas razões, as duas de camada:
 *   1. `SheetContent` é `z-[51]` cravado. Tudo que abre de DENTRO da gaveta e
 *      nasce `z-50` — tooltip, popover de qualificação, "Criar negócio",
 *      "Valor da venda" — pintaria ATRÁS dela. Com o `z-50` do diálogo o
 *      desempate volta a ser a ordem do DOM, que é como o painel funcionava;
 *   2. o véu do mockup é claro e desfocado (o funil continua legível atrás), e
 *      só o `DialogContent` aceita `overlayClassName`.
 * No celular continua a folha de baixo de sempre — é o padrão do produto ali, e
 * os conteúdos aninhados já sobem para `z-[60]`/`z-[70]` por causa dela.
 *
 * O deslize vem da direita trocando as variáveis do `tailwindcss-animate` por
 * estilo em linha: a classe do primitivo entra pelo centro (`slide-in-from-
 * left-1/2`, `zoom-in-95`) e duas classes do plugin para a mesma variável não
 * têm vencedor garantido. Estilo em linha tem.
 */
const DESLIZE_DA_DIREITA = {
  "--tw-enter-translate-x": "2rem",
  "--tw-enter-translate-y": "0",
  "--tw-enter-scale": "1",
  "--tw-exit-translate-x": "2rem",
  "--tw-exit-translate-y": "0",
  "--tw-exit-scale": "1",
} as CSSProperties;

const LARGURA = {
  ficha: "w-[min(560px,calc(100%-1.5rem))]",
  negocio: "w-[min(640px,calc(100%-1.5rem))]",
} as const;

export function GavetaLateral({
  aberta,
  onFechar,
  celular,
  largura = "ficha",
  rotulo,
  children,
}: {
  aberta: boolean;
  onFechar: () => void;
  celular: boolean;
  largura?: keyof typeof LARGURA;
  /** Nome acessível da gaveta (o Radix não acha título nela). */
  rotulo?: string;
  children: ReactNode;
}) {
  if (celular) {
    return (
      <Sheet open={aberta} onOpenChange={(v) => !v && onFechar()}>
        <SheetContent
          side="bottom"
          aria-label={rotulo}
          className="h-[94dvh] gap-0 overflow-hidden rounded-t-panel bg-background p-0"
        >
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={aberta} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent
        aria-label={rotulo}
        style={DESLIZE_DA_DIREITA}
        overlayClassName="bg-black/40 backdrop-blur-[3px]"
        className={cn(
          "bottom-3 left-auto right-3 top-3 flex max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden",
          "rounded-panel border-card-border bg-background p-0 shadow-relevo-alto duration-300 ease-drawer",
          LARGURA[largura],
        )}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
