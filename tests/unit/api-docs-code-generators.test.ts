import { describe, it, expect } from "vitest";
import {
  generateCurl,
  generateJavaScript,
  generatePython,
  type OrgContext,
} from "../../src/lib/api-docs/code-generators";
import type { ApiEndpoint } from "../../src/lib/api-docs/types";

const mockEndpoint: ApiEndpoint = {
  id: "test-endpoint",
  name: "Test Endpoint",
  description: "Test",
  category: "webhooks",
  version: "v1",
  method: "POST",
  path: "/functions/v1/test",
  auth: {
    type: "api-key",
    header: "X-Webhook-Key",
    description: "API key",
  },
  parameters: [],
  requestExample: {
    source: "test",
    organization_id: "uuid-da-organizacao",
  },
  responseExample: { success: true },
  responseFields: [],
};

const org: OrgContext = {
  baseUrl: "https://api.example.com",
  organizationId: "org-123",
  apiKey: "key-abc",
};

describe("generateCurl", () => {
  it("generates valid curl command", () => {
    const curl = generateCurl(mockEndpoint, org);
    expect(curl).toContain("curl -X POST");
    expect(curl).toContain("https://api.example.com/functions/v1/test");
    expect(curl).toContain("Content-Type: application/json");
  });

  it("includes auth header", () => {
    const curl = generateCurl(mockEndpoint, org);
    expect(curl).toContain("X-Webhook-Key: key-abc");
  });

  it("replaces org placeholders in body", () => {
    const curl = generateCurl(mockEndpoint, org);
    expect(curl).toContain("org-123");
    expect(curl).not.toContain("uuid-da-organizacao");
  });
});

describe("generateJavaScript", () => {
  it("generates fetch call", () => {
    const js = generateJavaScript(mockEndpoint, org);
    expect(js).toContain("fetch(");
    expect(js).toContain("https://api.example.com/functions/v1/test");
    expect(js).toContain('"POST"');
  });

  it("includes auth header", () => {
    const js = generateJavaScript(mockEndpoint, org);
    expect(js).toContain("X-Webhook-Key");
    expect(js).toContain("key-abc");
  });

  it("includes response handling", () => {
    const js = generateJavaScript(mockEndpoint, org);
    expect(js).toContain("response.json()");
  });
});

describe("generatePython", () => {
  it("generates requests call", () => {
    const py = generatePython(mockEndpoint, org);
    expect(py).toContain("import requests");
    expect(py).toContain("requests.post");
    expect(py).toContain("https://api.example.com/functions/v1/test");
  });

  it("includes auth header", () => {
    const py = generatePython(mockEndpoint, org);
    expect(py).toContain("X-Webhook-Key");
  });

  it("includes json parameter", () => {
    const py = generatePython(mockEndpoint, org);
    expect(py).toContain("json=");
  });

  it("includes response handling", () => {
    const py = generatePython(mockEndpoint, org);
    expect(py).toContain("response.json()");
  });
});

describe("code generators — no auth", () => {
  const noAuthEndpoint: ApiEndpoint = {
    ...mockEndpoint,
    auth: { type: "none", header: "", description: "" },
  };

  it("curl without auth header", () => {
    const curl = generateCurl(noAuthEndpoint, org);
    expect(curl).not.toContain("X-Webhook-Key");
  });

  it("js without auth header", () => {
    const js = generateJavaScript(noAuthEndpoint, org);
    expect(js).not.toContain("X-Webhook-Key");
  });
});
