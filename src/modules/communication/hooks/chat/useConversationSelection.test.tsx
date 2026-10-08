import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConversationSelection } from "./useConversationSelection";
import { contactKey } from "./types";
import { batchContact } from "../../../../../tests/helpers/conversationBatch";

describe("conversation selection", () => {
  const a = batchContact("1"), b = batchContact("2");
  it("selects only available rows; removed rows do not reappear selected", () => {
    const { result, rerender } = renderHook(({ contacts }) => useConversationSelection("filter", contacts, true), { initialProps: { contacts: [a, b] } });
    act(() => { result.current.setSelecting(true); result.current.setSelection(new Set([contactKey(a), contactKey(b)])); });
    rerender({ contacts: [b] });
    expect(result.current.selected).toEqual([b]);
    rerender({ contacts: [a, b] });
    expect(result.current.selected).toEqual([b]);
  });
  it("clears on scope change and ignores completion of an older batch after returning", () => {
    const { result, rerender } = renderHook(({ scope }) => useConversationSelection(scope, [a, b], true), { initialProps: { scope: "org-filter-a" } });
    act(() => { result.current.setSelecting(true); result.current.toggle(contactKey(a)); });
    const oldCompletion = result.current.setSelection;
    rerender({ scope: "org-filter-b" });
    expect(result.current.selecting).toBe(false);
    expect(result.current.selected).toEqual([]);
    rerender({ scope: "org-filter-a" });
    act(() => oldCompletion(new Set([contactKey(a)])));
    expect(result.current.selected).toEqual([]);
  });
  it("does not select while processing or when the feature is disabled", () => {
    const { result, rerender } = renderHook(({ enabled }) => useConversationSelection("scope", [a], enabled), { initialProps: { enabled: true } });
    act(() => result.current.setBusy(true));
    act(() => result.current.toggle(contactKey(a)));
    expect(result.current.selected).toEqual([]);
    rerender({ enabled: false });
    expect(result.current.eligible).toEqual([]);
    expect(result.current.selecting).toBe(false);
  });
});
