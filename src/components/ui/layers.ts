import { createContext, useContext } from "react";

/**
 * Escala única de camadas (z-index) dos overlays do app.
 *
 * Por que existe: cada primitivo de `components/ui` escolhia o próprio z, e a
 * gaveta (`SheetContent`, `z-[51]`) acabou ACIMA das listas (`z-50`) e do
 * `AlertDialog` (`z-50`) que abrem de dentro dela. Os portais do Radix são
 * irmãos no `body`, no mesmo contexto de empilhamento: o z decide sozinho, e
 * a ordem do DOM só desempata. Resultado medido em /master/operacao: lista
 * "Mover para…" que "não abre" e botão Confirmar coberto pela gaveta.
 *
 * Ordem (estrita, de baixo para cima) e o motivo de cada degrau:
 *
 *   modalOverlay  50  escurecido de Sheet / Dialog / Drawer.
 *   modalContent  51  painel de Sheet / Dialog / Drawer. Acima do PRÓPRIO
 *                     overlay sem depender da ordem do DOM.
 *   popper        60  Select, Popover, DropdownMenu, ContextMenu, Menubar,
 *                     HoverCard (e os comboboxes, que são Popover). Toda lista
 *                     aberta de dentro de uma gaveta/diálogo pinta acima dela.
 *   alertOverlay  70  escurecido do AlertDialog. Confirmação é a última
 *                     palavra: escurece a gaveta, o diálogo E as listas.
 *   alertContent  71  caixa do AlertDialog.
 *   alertPopper   72  lista aberta de DENTRO de um AlertDialog (ver abaixo).
 *   tooltip       80  dica nunca fica atrás de nada que a originou, nem de
 *                     uma confirmação.
 *   toast        100  `ui/toast.tsx` já era `z-[100]`; o Sonner pinta com o
 *                     próprio CSS (z altíssimo) e não é tocado aqui.
 *
 * Decisão — popper DENTRO de AlertDialog: sobe para `alertPopper` (72),
 * acima da caixa do alerta e abaixo da dica. Existe de verdade: o Select de
 * destino em `useFunilMoveFlow`, `DeletePipelineDialog` e
 * `ManagePipelineStagesModal` mora dentro de um `AlertDialogContent`. Quem
 * decide não é o chamador: `AlertDialogContent` publica `alertPopper` em
 * `PopperLayerContext`, e todo conteúdo de popper lê o degrau dali
 * (`usePopperLayerClass`). Contexto React atravessa portal, então a lista
 * herda o degrau da superfície que a ABRIU — não o da superfície por onde o
 * DOM dela passa. Fora de um alerta, o degrau é `popper` (60): uma lista
 * esquecida aberta atrás de uma confirmação não a atravessa.
 *
 * Diálogo aninhado (Dialog aberto de dentro de uma Sheet): a convenção do
 * repo é `className="z-[60]" overlayClassName="z-[60]"` no chamador — empata
 * com `popper`, e listas abertas de dentro dele vencem pelo DOM (o portal
 * delas monta depois) ou sobem explicitamente para `z-[70]`. Continua
 * coerente com esta escala: acima da gaveta, abaixo do AlertDialog.
 *
 * As classes são literais completos de propósito: o Tailwind só gera o que
 * acha escrito por inteiro nos arquivos de `src/`. Nunca monte `z-[${n}]`.
 */
export const LAYER = {
  modalOverlay: 50,
  modalContent: 51,
  popper: 60,
  alertOverlay: 70,
  alertContent: 71,
  alertPopper: 72,
  tooltip: 80,
  toast: 100,
} as const;

export type Layer = keyof typeof LAYER;

export const LAYER_CLASS = {
  modalOverlay: "z-50",
  modalContent: "z-[51]",
  popper: "z-[60]",
  alertOverlay: "z-[70]",
  alertContent: "z-[71]",
  alertPopper: "z-[72]",
  tooltip: "z-[80]",
  toast: "z-[100]",
} as const satisfies Record<Layer, string>;

/** Degrau que um conteúdo de popper usa: `popper`, ou `alertPopper` dentro de um AlertDialog. */
export type PopperLayerClass = (typeof LAYER_CLASS)["popper" | "alertPopper"];

export const PopperLayerContext = createContext<PopperLayerClass>(LAYER_CLASS.popper);

/** Classe z do conteúdo de popper, conforme a superfície que o abriu. */
export function usePopperLayerClass(): PopperLayerClass {
  return useContext(PopperLayerContext);
}
