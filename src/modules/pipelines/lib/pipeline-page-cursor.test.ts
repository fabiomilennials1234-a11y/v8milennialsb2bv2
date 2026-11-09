import { describe, expect, it } from "vitest";
import { nextPipelinePageCursor, pipelinePageCursorArgs } from "./pipeline-page-cursor";

const row = (id: string, created_at: string) => ({ id, created_at });

describe("nextPipelinePageCursor", () => {
  it("página cheia → cursor com TODAS as colunas da ordem (created_at E id)", () => {
    const page = [row("b", "2026-10-01T12:00:00Z"), row("a", "2026-10-01T12:00:00Z")];
    expect(nextPipelinePageCursor(page, 2)).toEqual({ createdAt: "2026-10-01T12:00:00Z", id: "a" });
  });

  it("página incompleta → acabou", () => {
    expect(nextPipelinePageCursor([row("a", "2026-10-01T12:00:00Z")], 2)).toBeUndefined();
    expect(nextPipelinePageCursor([], 20)).toBeUndefined();
  });

  it("linha sem id ou sem created_at → para em vez de pedir página que pularia linhas", () => {
    expect(nextPipelinePageCursor([{ created_at: "2026-10-01T12:00:00Z" }], 1)).toBeUndefined();
    expect(nextPipelinePageCursor([{ id: "a" }], 1)).toBeUndefined();
  });
});

describe("pipelinePageCursorArgs", () => {
  it("primeira página → os dois nulos", () => {
    expect(pipelinePageCursorArgs(null)).toEqual({ p_cursor: null, p_cursor_id: null });
    expect(pipelinePageCursorArgs(undefined)).toEqual({ p_cursor: null, p_cursor_id: null });
  });

  it("cursor → p_cursor e p_cursor_id juntos, nunca um sem o outro", () => {
    expect(pipelinePageCursorArgs({ createdAt: "2026-10-01T12:00:00Z", id: "a" })).toEqual({
      p_cursor: "2026-10-01T12:00:00Z",
      p_cursor_id: "a",
    });
  });
});
