/**
 * Escala de camadas dos overlays (`src/components/ui/layers.ts`).
 *
 * Defeito que isto trava (medido em /master/operacao, gaveta do Chamado
 * aberta): `SheetContent` z 51, lista do "Mover para…" z 50 e o
 * `AlertDialog` de confirmação z 50. Portais do Radix são irmãos no `body`,
 * então 51 vence 50: a lista "não abria" e o botão Confirmar ficava coberto
 * pela gaveta.
 *
 * O z é lido da CLASSE aplicada (jsdom não compila Tailwind): cada elemento
 * tem de carregar exatamente um token `z-*` de base, e ele tem de ser o da
 * escala. Isso prova a ordem sem depender de CSS compilado; a prova com CSS
 * real fica no roteiro de verificação no ar do PR.
 */
import React from "react";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LAYER, LAYER_CLASS, type Layer } from "@/components/ui/layers";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";

beforeAll(() => {
  // jsdom não implementa estes; o Radix Select os chama ao abrir/posicionar.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
});

/** O z de base (sem variante `xx:`) do elemento, lido da classe. Exige exatamente um. */
function zOf(el: Element | null): number {
  expect(el, "elemento não encontrado").toBeTruthy();
  const tokens = (el as Element).className
    .toString()
    .split(/\s+/)
    .map(t => /^z-(?:(\d+)|\[(\d+)\])$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null);
  expect(tokens, `tokens z em "${(el as Element).className}"`).toHaveLength(1);
  return Number(tokens[0][1] ?? tokens[0][2]);
}

/** O overlay escurecido do portal aberto (irmão do conteúdo). */
function overlayOf(content: Element): Element | null {
  const prev = content.previousElementSibling;
  if (prev && prev.className.toString().includes("inset-0")) return prev;
  return document.querySelector('[data-state="open"][class*="inset-0"]');
}

const ORDEM: Layer[] = [
  "modalOverlay",
  "modalContent",
  "popper",
  "alertOverlay",
  "alertContent",
  "alertPopper",
  "tooltip",
  "toast",
];

describe("escala de camadas — layers.ts", () => {
  it("cobre todos os degraus, na ordem estrita", () => {
    expect(Object.keys(LAYER).sort()).toEqual([...ORDEM].sort());
    for (let i = 1; i < ORDEM.length; i++) {
      expect(LAYER[ORDEM[i]], `${ORDEM[i - 1]} < ${ORDEM[i]}`).toBeGreaterThan(LAYER[ORDEM[i - 1]]);
    }
  });

  it("cada classe Tailwind é o literal do número da escala", () => {
    for (const k of ORDEM) {
      expect(zOf({ className: LAYER_CLASS[k] } as Element), k).toBe(LAYER[k]);
    }
  });

  it("toast fica no z-[100] que `ui/toast.tsx` já usava (não rebaixa)", () => {
    expect(LAYER.toast).toBe(100);
  });
});

describe("cada primitivo usa o degrau certo", () => {
  it("Sheet: overlay modalOverlay, conteúdo modalContent", () => {
    render(
      <Sheet open>
        <SheetContent data-testid="c">
          <SheetTitle>t</SheetTitle>
          <SheetDescription>d</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const c = screen.getByTestId("c");
    expect(zOf(c)).toBe(LAYER.modalContent);
    expect(zOf(overlayOf(c))).toBe(LAYER.modalOverlay);
  });

  it("Dialog: overlay modalOverlay, conteúdo modalContent", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="c">
          <DialogTitle>t</DialogTitle>
          <DialogDescription>d</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const c = screen.getByTestId("c");
    expect(zOf(c)).toBe(LAYER.modalContent);
    expect(zOf(overlayOf(c))).toBe(LAYER.modalOverlay);
  });

  it("Drawer (vaul): overlay modalOverlay, conteúdo modalContent", () => {
    render(
      <Drawer open>
        <DrawerContent data-testid="c">
          <DrawerTitle>t</DrawerTitle>
          <DrawerDescription>d</DrawerDescription>
        </DrawerContent>
      </Drawer>,
    );
    const c = screen.getByTestId("c");
    expect(zOf(c)).toBe(LAYER.modalContent);
    expect(zOf(document.querySelector("[data-vaul-overlay]"))).toBe(LAYER.modalOverlay);
  });

  it("AlertDialog: overlay alertOverlay, conteúdo alertContent", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent data-testid="c">
          <AlertDialogTitle>t</AlertDialogTitle>
          <AlertDialogDescription>d</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const c = screen.getByTestId("c");
    expect(zOf(c)).toBe(LAYER.alertContent);
    expect(zOf(overlayOf(c))).toBe(LAYER.alertOverlay);
  });

  it("Select: popper", () => {
    render(
      <Select open defaultValue="a">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent data-testid="c">
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(zOf(screen.getByTestId("c"))).toBe(LAYER.popper);
  });

  it("Popover: popper", () => {
    render(
      <Popover open>
        <PopoverTrigger>abrir</PopoverTrigger>
        <PopoverContent data-testid="c">x</PopoverContent>
      </Popover>,
    );
    expect(zOf(screen.getByTestId("c"))).toBe(LAYER.popper);
  });

  it("DropdownMenu: popper", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>abrir</DropdownMenuTrigger>
        <DropdownMenuContent data-testid="c">
          <DropdownMenuItem>x</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(zOf(screen.getByTestId("c"))).toBe(LAYER.popper);
  });

  it("ContextMenu: popper", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>alvo</ContextMenuTrigger>
        <ContextMenuContent data-testid="c">
          <ContextMenuItem>x</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText("alvo"));
    expect(zOf(screen.getByTestId("c"))).toBe(LAYER.popper);
  });

  it("HoverCard: popper", () => {
    render(
      <HoverCard open>
        <HoverCardTrigger>alvo</HoverCardTrigger>
        <HoverCardContent data-testid="c">x</HoverCardContent>
      </HoverCard>,
    );
    expect(zOf(screen.getByTestId("c"))).toBe(LAYER.popper);
  });

  it("Tooltip: tooltip", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>alvo</TooltipTrigger>
          <TooltipContent data-testid="c">dica</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(zOf(screen.getByTestId("c"))).toBe(LAYER.tooltip);
  });

  it("override explícito do chamador ainda vence (tailwind-merge)", () => {
    render(
      <Popover open>
        <PopoverTrigger>abrir</PopoverTrigger>
        <PopoverContent data-testid="c" className="z-[70]">
          x
        </PopoverContent>
      </Popover>,
    );
    expect(zOf(screen.getByTestId("c"))).toBe(70);
  });
});

describe("regressão /master/operacao — gaveta com lista e confirmação", () => {
  it("lista e AlertDialog abertos de dentro da gaveta pintam ACIMA dela; o overlay do alerta cobre a gaveta", () => {
    render(
      <Sheet open>
        <SheetContent data-testid="gaveta">
          <SheetTitle>Chamado</SheetTitle>
          <SheetDescription>gaveta</SheetDescription>
          <Select open defaultValue="em_andamento">
            <SelectTrigger aria-label="Mover para">
              <SelectValue />
            </SelectTrigger>
            <SelectContent data-testid="lista-mover">
              <SelectItem value="em_andamento">Em andamento</SelectItem>
              <SelectItem value="resolvido">Resolvido</SelectItem>
            </SelectContent>
          </Select>
          <AlertDialog open>
            <AlertDialogContent data-testid="confirmacao">
              <AlertDialogTitle>Mover?</AlertDialogTitle>
              <AlertDialogDescription>confirmar</AlertDialogDescription>
              <AlertDialogAction>Confirmar</AlertDialogAction>
            </AlertDialogContent>
          </AlertDialog>
        </SheetContent>
      </Sheet>,
    );

    const gaveta = zOf(screen.getByTestId("gaveta"));
    const lista = zOf(screen.getByTestId("lista-mover"));
    const alerta = screen.getByTestId("confirmacao");
    const alertaZ = zOf(alerta);
    const alertaOverlay = zOf(overlayOf(alerta));

    expect(lista).toBeGreaterThan(gaveta);
    expect(alertaOverlay).toBeGreaterThan(gaveta);
    expect(alertaOverlay).toBeGreaterThan(lista);
    expect(alertaZ).toBeGreaterThan(alertaOverlay);
    expect({ gaveta, lista, alertaOverlay, alerta: alertaZ }).toEqual({
      gaveta: 51,
      lista: 60,
      alertaOverlay: 70,
      alerta: 71,
    });
  });

  it("Select aberto de DENTRO de um AlertDialog (useFunilMoveFlow, DeletePipelineDialog) pinta acima da caixa do alerta", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent data-testid="confirmacao">
          <AlertDialogTitle>Excluir funil?</AlertDialogTitle>
          <AlertDialogDescription>mover os leads para</AlertDialogDescription>
          <Select open defaultValue="x">
            <SelectTrigger aria-label="destino">
              <SelectValue />
            </SelectTrigger>
            <SelectContent data-testid="lista-destino">
              <SelectItem value="x">Funil X</SelectItem>
            </SelectContent>
          </Select>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const alerta = zOf(screen.getByTestId("confirmacao"));
    const lista = zOf(screen.getByTestId("lista-destino"));
    expect(lista).toBe(LAYER.alertPopper);
    expect(lista).toBeGreaterThan(alerta);
    expect(lista).toBeLessThan(LAYER.tooltip);
  });

  it("fora de um alerta a lista volta ao degrau popper (o contexto não vaza)", () => {
    render(
      <>
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>a</AlertDialogTitle>
            <AlertDialogDescription>b</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>
        <Popover open>
          <PopoverTrigger>abrir</PopoverTrigger>
          <PopoverContent data-testid="fora">x</PopoverContent>
        </Popover>
      </>,
    );
    expect(zOf(screen.getByTestId("fora"))).toBe(LAYER.popper);
  });
});
