import { renderHook, act, waitFor } from "@testing-library/react";
import { useInlineEdit } from "../hooks/useInlineEdit";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("useInlineEdit", () => {
  it("keeps the second saved name when the first refetch arrives during that save", async () => {
    let finish!: () => void;
    const onSave = vi.fn().mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(
      ({ value }) => useInlineEdit({ value, onSave }),
      { initialProps: { value: "Ana" } },
    );
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue("Ana Silva"));
    await act(async () => result.current.commit());
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue("Ana Souza"));
    act(() => { void result.current.commit(); });
    rerender({ value: "Ana Silva" });
    await act(async () => finish());
    expect(result.current.localValue).toBe("Ana Souza");
    act(() => result.current.startEditing());
    expect(result.current.localValue).toBe("Ana Souza");
  });

  it("ignores duplicate commits while saving and allows the next edit", async () => {
    let finish!: () => void;
    const onSave = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useInlineEdit({ value: "Ana", onSave }));
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue("Ana Silva"));
    act(() => { void result.current.commit(); void result.current.commit(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(result.current.localValue).toBe("Ana Silva");
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue("Ana"));
    await act(async () => result.current.commit());
    expect(onSave).toHaveBeenNthCalledWith(2, "Ana");
  });

  it("adopts a normalized server value received during saving", async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(
      ({ value }) => useInlineEdit({ value, onSave }),
      { initialProps: { value: "Ana" } },
    );
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue(" Ana Silva "));
    act(() => { void result.current.commit(); });
    rerender({ value: "Ana Silva" });
    await act(async () => finish());
    expect(result.current.localValue).toBe("Ana Silva");
  });

  it("allows retry after a failed save without losing the last saved name", async () => {
    const onSave = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const { result } = renderHook(() => useInlineEdit({ value: "Ana", onSave }));
    for (const name of ["Ana Silva", "Ana Souza", "Ana Santos"]) {
      act(() => result.current.startEditing());
      act(() => result.current.setLocalValue(name));
      await act(async () => result.current.commit());
      expect(result.current.isSaving).toBe(false);
      expect(result.current.localValue).toBe(name === "Ana Souza" ? "Ana Silva" : name);
    }
    expect(onSave).toHaveBeenCalledTimes(3);
  });

  it("does not save a cancelled edit when blur follows Escape", async () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useInlineEdit({ value: "Ana", onSave }));
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue("Ana Silva"));
    const commitOnBlur = result.current.commit;
    act(() => result.current.cancel());
    await act(async () => commitOnBlur());
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.localValue).toBe("Ana");
  });

  it("initializes with provided value", () => {
    const { result } = renderHook(() =>
      useInlineEdit({ value: "hello", onSave: vi.fn() })
    );
    expect(result.current.localValue).toBe("hello");
    expect(result.current.isEditing).toBe(false);
    expect(result.current.isSaving).toBe(false);
  });

  it("enters edit mode and tracks local changes", () => {
    const { result } = renderHook(() =>
      useInlineEdit({ value: "hello", onSave: vi.fn() })
    );
    act(() => result.current.startEditing());
    expect(result.current.isEditing).toBe(true);

    act(() => result.current.setLocalValue("world"));
    expect(result.current.localValue).toBe("world");
  });

  it("calls onSave and exits edit mode on commit", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useInlineEdit({ value: "hello", onSave })
    );
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue("world"));
    await act(async () => result.current.commit());

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("world");
      expect(result.current.isEditing).toBe(false);
    });
  });

  it("reverts local value on cancel", () => {
    const { result } = renderHook(() =>
      useInlineEdit({ value: "hello", onSave: vi.fn() })
    );
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue("world"));
    act(() => result.current.cancel());

    expect(result.current.localValue).toBe("hello");
    expect(result.current.isEditing).toBe(false);
  });

  it("rolls back on save error", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() =>
      useInlineEdit({ value: "hello", onSave })
    );
    act(() => result.current.startEditing());
    act(() => result.current.setLocalValue("world"));
    await act(async () => result.current.commit());

    await waitFor(() => {
      expect(result.current.localValue).toBe("hello");
      expect(result.current.isEditing).toBe(false);
    });
  });

  it("skips save if value unchanged", async () => {
    const onSave = vi.fn();
    const { result } = renderHook(() =>
      useInlineEdit({ value: "hello", onSave })
    );
    act(() => result.current.startEditing());
    await act(async () => result.current.commit());

    await waitFor(() => {
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  it("syncs localValue when external value prop changes", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useInlineEdit({ value, onSave: vi.fn() }),
      { initialProps: { value: "hello" } }
    );
    rerender({ value: "updated" });
    expect(result.current.localValue).toBe("updated");
  });
});
