import { cn } from "@/lib/utils";

/**
 * Classes compartilhadas pelas abas de Configurações (V5). Ficam fora de
 * `settings-ui.tsx` para o arquivo de componentes só exportar componentes
 * (Fast Refresh).
 */

/** Botões sobre o ouro do `FocusCard` — o mesmo par do Comando e das Automações. */
export const botaoNoOuro =
  "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground [&_svg]:h-3.5 [&_svg]:w-3.5";
/** Primário: pílula clara. */
export const botaoNoOuroPrimario = cn(botaoNoOuro, "bg-tinta-foreground text-primary-foreground shadow-relevo hover:bg-tinta-foreground/90");
/** Secundário: translúcido. */
export const botaoNoOuroSecundario = cn(
  botaoNoOuro,
  "border border-primary-foreground/15 bg-primary-foreground/[.07] hover:bg-primary-foreground/[.12]",
);

/** Vidro dentro da tinta (blocos de controle do painel escuro). */
export const vidroNaTinta = "rounded-2xl border border-white/[.08] bg-white/[.04] p-4";

/** Chave (Switch) legível sobre a tinta: o `bg-input` do cartão some no escuro. */
export const chaveNaTinta = "data-[state=unchecked]:bg-white/15 focus-visible:ring-offset-tinta";
