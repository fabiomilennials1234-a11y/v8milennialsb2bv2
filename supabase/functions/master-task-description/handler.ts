import type { DescriptionInput, DescriptionResult } from "./generate.ts";

interface MasterActor { isActive: boolean; permissions: unknown }
export interface DescriptionDependencies {
  authenticate: (req: Request) => Promise<MasterActor | null>;
  generate: (input: DescriptionInput) => Promise<DescriptionResult>;
  headers: (req: Request) => Record<string, string>;
}

/** Autorização precede leitura do corpo e qualquer chamada cobrada ao modelo. */
export function createDescriptionHandler(deps: DescriptionDependencies) {
  return async (req: Request): Promise<Response> => {
    const headers = { ...deps.headers(req), "Content-Type": "application/json", "Cache-Control": "no-store" };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") return json(405, { error: "Use POST para gerar a descrição." });
    const actor = await deps.authenticate(req);
    if (!actor) return json(401, { error: "Entre novamente para gerar a descrição." });
    const permissions = actor.permissions as { all?: unknown } | null;
    if (!actor.isActive || !permissions || permissions.all !== true) {
      return json(403, { error: "A descrição de tarefas está disponível apenas para masters com acesso completo." });
    }
    if (Number(req.headers.get("content-length")) > 32768) return json(413, { error: "O contexto da tarefa é muito longo." });
    let body: Record<string, unknown>;
    try {
      const raw = await req.text();
      if (raw.length > 32768) return json(413, { error: "O contexto da tarefa é muito longo." });
      body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    } catch {
      return json(400, { error: "Informe o título e o contexto da tarefa." });
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const context = typeof body.context === "string" ? body.context.trim() : "";
    if (!title || title.length > 200 || context.length > 5000 || (body.context !== undefined && typeof body.context !== "string")) {
      return json(400, { error: "Informe um título de até 200 caracteres e um contexto de até 5.000 caracteres." });
    }
    try {
      return json(200, await deps.generate({ title, context }));
    } catch {
      // Não expor resposta do provedor, contexto da tarefa ou chave nos logs/cliente.
      return json(502, { error: "Não foi possível gerar a descrição agora. Tente novamente ou escreva a descrição manualmente." });
    }
  };
}
