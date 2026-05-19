import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { useAutoSaveField } from "./useAutoSaveField";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers();
  toastError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useAutoSaveField", () => {
  it("does not save on initial render", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoSaveField({ value: "a", save }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("debounces multiple changes into a single save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ value }) => useAutoSaveField({ value, save, debounceMs: 1500 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    rerender({ value: "abc" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    rerender({ value: "abcd" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abcd");
  });

  it("cancel() prevents a pending save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSaveField({ value, save, debounceMs: 1000 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => result.current.cancel());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("flush() saves immediately bypassing debounce", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSaveField({ value, save, debounceMs: 5000 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("b");
  });

  it("propagates error via toast and exposes lastError", async () => {
    const err = new Error("boom");
    const save = vi.fn().mockRejectedValue(err);
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSaveField({ value, save, debounceMs: 100 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await flush();
    expect(toastError).toHaveBeenCalled();
    expect(result.current.lastError?.message).toBe("boom");
  });

  it("invokes onError callback instead of toast when provided", async () => {
    const err = new Error("boom");
    const save = vi.fn().mockRejectedValue(err);
    const onError = vi.fn();
    const { rerender } = renderHook(
      ({ value }) => useAutoSaveField({ value, save, debounceMs: 50, onError }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await flush();
    expect(onError).toHaveBeenCalledWith(err);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("invalidates given query keys on success", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ value }) =>
        useAutoSaveField({
          value,
          save,
          debounceMs: 100,
          invalidateKeys: [["leads"], ["lead", "123"]],
          queryClient: qc,
        }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await flush();
    expect(save).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["leads"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["lead", "123"] });
  });

  it("isSaving toggles true during save and false after", async () => {
    let resolveFn: (() => void) | null = null;
    const save = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveFn = res;
        }),
    );
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSaveField({ value, save, debounceMs: 50 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.isSaving).toBe(true);
    await act(async () => {
      resolveFn?.();
      await Promise.resolve();
    });
    expect(result.current.isSaving).toBe(false);
  });
});
