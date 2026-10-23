import { appSecretProof, metaSecretForApp } from "./meta-business.ts";

/** Optional appId preserves the legacy API; all CRM calls pass the stored binding explicitly. */
export async function metaGraphFetch(input: string, init?: RequestInit, appId?: string | null): Promise<Response> {
  const url = new URL(input);
  if (url.origin !== "https://graph.facebook.com") throw new Error("untrusted_graph_origin");
  if (appId === undefined) return fetch(input, init);
  const secret = metaSecretForApp(appId);
  if (appId !== null) url.pathname = url.pathname.replace(/^\/v\d+\.\d+\//, "/v26.0/");
  const headers = new Headers(init?.headers);
  const json = typeof init?.body === "string" && headers.get("content-type")?.includes("application/json") ? JSON.parse(init.body) : null;
  const token = url.searchParams.get("access_token") ?? headers.get("authorization")?.replace(/^Bearer /, "") ?? json?.access_token;
  if (typeof token !== "string" || !token) throw new Error("missing_graph_token");
  url.searchParams.delete("access_token");
  headers.set("Authorization", `Bearer ${token}`);
  url.searchParams.set("appsecret_proof", await appSecretProof(token, secret));
  if (json) delete json.access_token;
  const response = await fetch(url.toString(), { ...init, headers, redirect: "error", ...(json ? { body: JSON.stringify(json) } : {}), signal: init?.signal ?? AbortSignal.timeout(15_000) });
  return response;
}
