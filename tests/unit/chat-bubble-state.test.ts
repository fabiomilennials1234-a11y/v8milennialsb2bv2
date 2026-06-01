/**
 * useChatBubbleState — persist {isOpen, isMinimized} no localStorage por userId.
 *
 * Cobre: default, persist, restore, troca de userId, falha silenciosa de
 * localStorage indisponível, JSON inválido, toggleMinimized.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatBubbleState } from "@/modules/communication/hooks/useChatBubbleState";

const KEY = (uid: string) => `chat-bubble:${uid}`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useChatBubbleState", () => {
  it("retorna default {isOpen:false, isMinimized:false} quando localStorage vazio", () => {
    const { result } = renderHook(() => useChatBubbleState("user-1"));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMinimized).toBe(false);
  });

  it("setOpen(true) persiste em localStorage com chave correta", () => {
    const { result } = renderHook(() => useChatBubbleState("user-1"));
    act(() => result.current.setOpen(true));
    const stored = localStorage.getItem(KEY("user-1"));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual({ isOpen: true, isMinimized: false });
  });

  it("restora estado de localStorage no mount", () => {
    localStorage.setItem(KEY("user-2"), JSON.stringify({ isOpen: true, isMinimized: true }));
    const { result } = renderHook(() => useChatBubbleState("user-2"));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isMinimized).toBe(true);
  });

  it("re-sincroniza quando userId muda", () => {
    localStorage.setItem(KEY("user-A"), JSON.stringify({ isOpen: true, isMinimized: false }));
    localStorage.setItem(KEY("user-B"), JSON.stringify({ isOpen: false, isMinimized: true }));
    const { result, rerender } = renderHook(
      ({ uid }: { uid: string }) => useChatBubbleState(uid),
      { initialProps: { uid: "user-A" } },
    );
    expect(result.current.isOpen).toBe(true);
    rerender({ uid: "user-B" });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMinimized).toBe(true);
  });

  it("userId null → default + NÃO escreve em localStorage", () => {
    const { result } = renderHook(() => useChatBubbleState(null));
    act(() => result.current.setOpen(true));
    // Verifica que nenhuma chave chat-bubble:null foi criada
    expect(localStorage.getItem("chat-bubble:null")).toBeNull();
    // Estado interno ainda atualiza (UI continua funcional sem persist)
    expect(result.current.isOpen).toBe(true);
  });

  it("userId undefined → default + NÃO escreve", () => {
    const { result } = renderHook(() => useChatBubbleState(undefined));
    act(() => result.current.setOpen(true));
    expect(localStorage.getItem("chat-bubble:undefined")).toBeNull();
  });

  it("JSON inválido em localStorage cai em default", () => {
    localStorage.setItem(KEY("user-junk"), "{not valid json");
    const { result } = renderHook(() => useChatBubbleState("user-junk"));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMinimized).toBe(false);
  });

  it("localStorage.setItem throws → falha silenciosa, sem crash", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceeded");
      });
    const { result } = renderHook(() => useChatBubbleState("user-1"));
    expect(() =>
      act(() => {
        result.current.setOpen(true);
      }),
    ).not.toThrow();
    setItemSpy.mockRestore();
  });

  it("toggleMinimized flipa o valor", () => {
    const { result } = renderHook(() => useChatBubbleState("user-1"));
    expect(result.current.isMinimized).toBe(false);
    act(() => result.current.toggleMinimized());
    expect(result.current.isMinimized).toBe(true);
    act(() => result.current.toggleMinimized());
    expect(result.current.isMinimized).toBe(false);
  });

  it("setMinimized(true) persiste sem afetar isOpen", () => {
    const { result } = renderHook(() => useChatBubbleState("user-1"));
    act(() => result.current.setOpen(true));
    act(() => result.current.setMinimized(true));
    const stored = JSON.parse(localStorage.getItem(KEY("user-1"))!);
    expect(stored).toEqual({ isOpen: true, isMinimized: true });
  });

  it("entrada parcial (sem isMinimized) preenche faltantes com default", () => {
    localStorage.setItem(KEY("user-partial"), JSON.stringify({ isOpen: true }));
    const { result } = renderHook(() => useChatBubbleState("user-partial"));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isMinimized).toBe(false);
  });
});
