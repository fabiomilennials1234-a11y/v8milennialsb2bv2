import { renderHook, act, waitFor } from "@testing-library/react";
import { useInlineEdit } from "../hooks/useInlineEdit";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("useInlineEdit", () => {
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
    act(() => result.current.commit());

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
    act(() => result.current.commit());

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
    act(() => result.current.commit());

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
