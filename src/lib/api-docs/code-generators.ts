import { ApiEndpoint } from "./types";

export interface OrgContext {
  baseUrl: string;
  organizationId: string;
  apiKey?: string;
}

function injectOrgData(example: Record<string, unknown>, org: OrgContext): Record<string, unknown> {
  const json = JSON.stringify(example);
  const injected = json
    .replace(/"uuid-da-organizacao"/g, `"${org.organizationId}"`)
    .replace(/"sua-api-key"/g, `"${org.apiKey || "SUA_API_KEY"}"`);
  return JSON.parse(injected);
}

function resolveAuthHeader(endpoint: ApiEndpoint): string | null {
  if (endpoint.auth.type !== "api-key") return null;
  return endpoint.auth.header.includes(" ") ? "X-Webhook-Key" : endpoint.auth.header;
}

export function generateCurl(endpoint: ApiEndpoint, org: OrgContext): string {
  const headerName = resolveAuthHeader(endpoint);
  const body = injectOrgData(endpoint.requestExample, org);
  const lines: string[] = [];
  lines.push(`curl -X ${endpoint.method} \\`);
  lines.push(`  "${org.baseUrl}${endpoint.path}" \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);
  if (headerName) {
    lines.push(`  -H "${headerName}: ${org.apiKey || "SUA_API_KEY"}" \\`);
  }
  lines.push(`  -d '${JSON.stringify(body, null, 2)}'`);
  return lines.join("\n");
}

export function generateJavaScript(endpoint: ApiEndpoint, org: OrgContext): string {
  const headerName = resolveAuthHeader(endpoint);
  const body = injectOrgData(endpoint.requestExample, org);
  const authLine = headerName ? `\n    "${headerName}": "${org.apiKey || "SUA_API_KEY"}",` : "";

  return `const response = await fetch("${org.baseUrl}${endpoint.path}", {
  method: "${endpoint.method}",
  headers: {
    "Content-Type": "application/json",${authLine}
  },
  body: JSON.stringify(${JSON.stringify(body, null, 4).split("\n").map((line, i) => i === 0 ? line : "  " + line).join("\n")}),
});

const data = await response.json();
console.log(data);`;
}

export function generatePython(endpoint: ApiEndpoint, org: OrgContext): string {
  const headerName = resolveAuthHeader(endpoint);
  const body = injectOrgData(endpoint.requestExample, org);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (headerName) {
    headers[headerName] = org.apiKey || "SUA_API_KEY";
  }

  return `import requests

response = requests.${endpoint.method.toLowerCase()}(
    "${org.baseUrl}${endpoint.path}",
    headers=${JSON.stringify(headers, null, 8).replace(/"/g, '"')},
    json=${JSON.stringify(body, null, 8)},
)

data = response.json()
print(data)`;
}
