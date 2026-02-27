import { ApiEndpoint } from "./types";

export function generateCurl(endpoint: ApiEndpoint, baseUrl: string): string {
  const lines: string[] = [];
  lines.push(`curl -X ${endpoint.method} \\`);
  lines.push(`  "${baseUrl}${endpoint.path}" \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);

  if (endpoint.auth.type === "api-key") {
    const headerName = endpoint.auth.header.includes(" ") ? "X-Webhook-Key" : endpoint.auth.header;
    lines.push(`  -H "${headerName}: SUA_API_KEY" \\`);
  }

  lines.push(`  -d '${JSON.stringify(endpoint.requestExample, null, 2)}'`);
  return lines.join("\n");
}

export function generateJavaScript(endpoint: ApiEndpoint, baseUrl: string): string {
  const authHeader = endpoint.auth.type === "api-key"
    ? `\n    "${endpoint.auth.header.includes(" ") ? "X-Webhook-Key" : endpoint.auth.header}": "SUA_API_KEY",`
    : "";

  return `const response = await fetch("${baseUrl}${endpoint.path}", {
  method: "${endpoint.method}",
  headers: {
    "Content-Type": "application/json",${authHeader}
  },
  body: JSON.stringify(${JSON.stringify(endpoint.requestExample, null, 4).split("\n").map((line, i) => i === 0 ? line : "  " + line).join("\n")}),
});

const data = await response.json();
console.log(data);
// ${JSON.stringify(endpoint.responseExample)}`;
}

export function generatePython(endpoint: ApiEndpoint, baseUrl: string): string {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (endpoint.auth.type === "api-key") {
    const headerName = endpoint.auth.header.includes(" ") ? "X-Webhook-Key" : endpoint.auth.header;
    headers[headerName] = "SUA_API_KEY";
  }

  return `import requests

response = requests.${endpoint.method.toLowerCase()}(
    "${baseUrl}${endpoint.path}",
    headers=${JSON.stringify(headers, null, 8).replace(/"/g, '"')},
    json=${JSON.stringify(endpoint.requestExample, null, 8)},
)

data = response.json()
print(data)
# ${JSON.stringify(endpoint.responseExample)}`;
}
