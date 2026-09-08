import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const demolition = readFileSync(
  resolve(root, "supabase/migrations/20271015000000_demolicao_dos_espelhos.sql"),
  "utf8",
);
const repair = readFileSync(
  resolve(root, "supabase/migrations/20271016002000_etapa_nova_nao_chama_funcao_demolida.sql"),
  "utf8",
);
const identityHook = readFileSync(
  resolve(root, "src/modules/pipelines/hooks/config/usePipelineIdentity.ts"),
  "utf8",
);

describe("contrato CRUD do funil após demolição dos espelhos", () => {
  it("remove o trigger antes de remover sua função e mantém stage_role seguro", () => {
    expect(demolition).toContain(
      "DROP FUNCTION IF EXISTS public.system_stage_role(text, text);",
    );
    expect(repair).toContain("stage_role sem DEFAULT open/NOT NULL");

    const dropTrigger = repair.indexOf(
      "DROP TRIGGER IF EXISTS trg_pipeline_stages_system_stage_role",
    );
    const dropTriggerFunction = repair.indexOf(
      "DROP FUNCTION IF EXISTS public.pipeline_stages_assign_system_stage_role();",
    );
    expect(dropTrigger).toBeGreaterThan(-1);
    expect(dropTriggerFunction).toBeGreaterThan(dropTrigger);
    expect(repair).toContain(
      "to_regprocedure('public.system_stage_role(text,text)') IS NOT NULL",
    );
  });

  it("renomeia só a identidade; slug e referências permanecem estáveis", () => {
    const updatePayload = identityHook.match(
      /\.update\(\{ name: trimmed, icon, color, updated_at:[\s\S]*?\}\)/,
    )?.[0];
    expect(updatePayload).toBeTruthy();
    expect(updatePayload).not.toContain("slug");
    expect(identityHook).toContain('"custom_pipeline"');
    expect(identityHook).toContain('"lead_all_pipelines"');
  });
});
