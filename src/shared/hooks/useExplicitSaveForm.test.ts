import { renderHook, act, waitFor } from "@testing-library/react";
import { useExplicitSaveForm } from "./useExplicitSaveForm";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

beforeEach(() => {
  toastError.mockReset();
});

describe("useExplicitSaveForm", () => {
  it("initializes with given state and dirty=false", () => {
    const { result } = renderHook(() =>
      useExplicitSaveForm({ initial: { name: "a" }, save: vi.fn() }),
    );
    expect(result.current.state).toEqual({ name: "a" });
    expect(result.current.dirty).toBe(false);
    expect(result.current.isPending).toBe(false);
  });

  it("flips dirty=true after setState diverges from initial", () => {
    const { result } = renderHook(() =>
      useExplicitSaveForm({ initial: { name: "a" }, save: vi.fn() }),
    );
    act(() => result.current.setState({ name: "b" }));
    expect(result.current.dirty).toBe(true);
  });

  it("flips dirty=false again when state returns to initial values", () => {
    const { result } = renderHook(() =>
      useExplicitSaveForm({ initial: { name: "a" }, save: vi.fn() }),
    );
    act(() => result.current.setState({ name: "b" }));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setState({ name: "a" }));
    expect(result.current.dirty).toBe(false);
  });

  it("calls save with current state and resets dirty on success", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExplicitSaveForm({ initial: { name: "a" }, save }),
    );
    act(() => result.current.setState({ name: "b" }));
    await act(async () => {
      await result.current.save();
    });
    expect(save).toHaveBeenCalledWith({ name: "b" });
    expect(result.current.dirty).toBe(false);
  });

  it("cancel() reverts to initial state and clears dirty", () => {
    const { result } = renderHook(() =>
      useExplicitSaveForm({ initial: { name: "a" }, save: vi.fn() }),
    );
    act(() => result.current.setState({ name: "b" }));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.state).toEqual({ name: "a" });
    expect(result.current.dirty).toBe(false);
  });

  it("propagates error via toast and keeps state intact (dirty stays true)", async () => {
    const err = new Error("boom");
    const save = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() =>
      useExplicitSaveForm({ initial: { name: "a" }, save }),
    );
    act(() => result.current.setState({ name: "b" }));
    await act(async () => {
      await result.current.save().catch(() => undefined);
    });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(result.current.state).toEqual({ name: "b" });
    expect(result.current.dirty).toBe(true);
    expect(result.current.lastError?.message).toBe("boom");
  });

  it("reset() adopts a new baseline (e.g. after server refresh)", () => {
    const { result } = renderHook(() =>
      useExplicitSaveForm({ initial: { name: "a" }, save: vi.fn() }),
    );
    act(() => result.current.setState({ name: "x" }));
    act(() => result.current.reset({ name: "c" }));
    expect(result.current.state).toEqual({ name: "c" });
    expect(result.current.dirty).toBe(false);
  });

  it("isPending toggles during async save", async () => {
    let resolveFn: (() => void) | null = null;
    const save = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveFn = res;
        }),
    );
    const { result } = renderHook(() =>
      useExplicitSaveForm({ initial: { v: 1 }, save }),
    );
    act(() => result.current.setState({ v: 2 }));
    let savePromise: Promise<void> | null = null;
    act(() => {
      savePromise = result.current.save();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await act(async () => {
      resolveFn?.();
      await savePromise;
    });
    expect(result.current.isPending).toBe(false);
  });
});
