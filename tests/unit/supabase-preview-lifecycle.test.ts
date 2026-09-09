// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { withSupabasePreview } from "../../scripts/supabase-preview-lifecycle.mjs";
const preview = { id: "qa-id", name: "qa-studio-test", project_ref: "abcdefghijklmnopqrst", is_default: false };
function fixture() {
  let branches: typeof preview[] = [];
  const list = vi.fn(async () => branches);
  const create = vi.fn(async () => { branches = [preview]; return preview; });
  const remove = vi.fn(async () => { branches = []; });
  return { name: preview.name, list, create, remove, test: vi.fn(async () => "ok") };
}
describe("preview — excluir é parte do teste", () => {
  it("exclui e confirma no inventário depois de sucesso", async () => {
    const deps = fixture();
    await expect(withSupabasePreview(deps)).resolves.toBe("ok");
    expect(deps.remove).toHaveBeenCalledWith("qa-id");
    expect(deps.list).toHaveBeenCalledTimes(2);
  });
  it("exclui também quando SQL ou teste falha", async () => {
    const deps = fixture();
    deps.test.mockRejectedValueOnce(new Error("SQL recusado"));
    await expect(withSupabasePreview(deps)).rejects.toThrow("SQL recusado");
    expect(deps.remove).toHaveBeenCalledWith("qa-id");
  });
  it("não declara sucesso se a exclusão falhar", async () => {
    const deps = fixture();
    deps.remove.mockRejectedValueOnce(new Error("Sem conexão"));
    await expect(withSupabasePreview(deps)).rejects.toThrow("Cleanup não confirmado");
  });
  it("não declara sucesso se DELETE não retirar a branch", async () => {
    const deps = fixture();
    deps.remove.mockImplementationOnce(async () => {});
    await expect(withSupabasePreview(deps)).rejects.toThrow("Cleanup não confirmado");
  });
  it("não toca em preview de outro trabalho", async () => {
    const deps = fixture();
    deps.list.mockResolvedValue([{ ...preview, id: "other", name: "outra-tarefa" }]);
    await expect(withSupabasePreview(deps)).rejects.toThrow("segunda exige");
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });
  it("nunca executa teste ou DELETE em produção, mesmo com resposta malformada", async () => {
    const deps = fixture();
    deps.create.mockResolvedValueOnce({ ...preview, project_ref: "jsjsmuncfkbsbzqzqhfq" });
    await expect(withSupabasePreview(deps)).rejects.toThrow("alvo inseguro");
    expect(deps.test).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });
  it("recupera pelo nome exclusivo se a resposta da criação se perder", async () => {
    const deps = fixture();
    deps.list.mockResolvedValueOnce([]).mockResolvedValueOnce([preview]).mockResolvedValueOnce([]);
    deps.create.mockRejectedValueOnce(new Error("Resposta perdida"));
    await expect(withSupabasePreview(deps)).rejects.toThrow("Resposta perdida");
    expect(deps.remove).toHaveBeenCalledWith("qa-id");
  });
});
