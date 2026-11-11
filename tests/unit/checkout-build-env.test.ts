// @vitest-environment node
/**
 * Vite troca variável ausente por `undefined` e builda: sem a chave pública no pipeline, todo
 * link de pagamento em produção mostraria "indisponível", sem erro nenhum. Mesmo risco nos
 * dois caminhos de build, por isso os dois estão amarrados aqui.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const NAME = "VITE_STRIPE_PUBLISHABLE_KEY";

describe(NAME, () => {
  it("deploy-front-cloudflare.yml", () => {
    const wf = parse(read(".github/workflows/deploy-front-cloudflare.yml"));
    expect(wf.jobs.build.env[NAME]).toBe(`\${{ vars.${NAME} }}`);
  });
  it("Dockerfile: ARG e ENV no estágio de build", () => {
    const docker = read("Dockerfile");
    expect(docker).toMatch(new RegExp(`^ARG ${NAME}$`, "m"));
    expect(docker).toContain(`${NAME}=\${${NAME}}`);
  });
  it("docker-image.yml: build-args", () => {
    expect(read(".github/workflows/docker-image.yml")).toContain(`${NAME}=\${{ vars.${NAME} }}`);
  });
  it("só a pública tem VITE_: segredo nunca entra no bundle", () => {
    for (const f of [".github/workflows/deploy-front-cloudflare.yml", ".github/workflows/docker-image.yml", "Dockerfile"]) {
      expect(read(f)).not.toMatch(/VITE_STRIPE_SECRET|VITE_STRIPE_WEBHOOK/);
    }
  });
});
