import { useState, useCallback } from "react";
import { Play, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { JsonBlock } from "./JsonBlock";
import type { ApiEndpoint, ApiParam } from "@/lib/api-docs/types";
import type { OrgContext } from "@/lib/api-docs/code-generators";
import { userMessageOf } from "@/shared/errors";

interface ApiExplorerProps {
  endpoint: ApiEndpoint;
  orgContext: OrgContext;
}

interface ExplorerResponse {
  status: number;
  statusText: string;
  body: Record<string, unknown>;
  duration: number;
}

function buildDefaultValues(params: ApiParam[], orgContext: OrgContext): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of params) {
    if (p.children) {
      values[p.name] = buildDefaultValues(p.children, orgContext);
    } else if (p.name === "organization_id" || p.name === "tenant_id") {
      values[p.name] = orgContext.organizationId;
    } else if (p.name === "api_key") {
      values[p.name] = orgContext.apiKey || "";
    } else if (p.type === "boolean") {
      values[p.name] = p.defaultValue === "true";
    } else {
      values[p.name] = p.defaultValue || "";
    }
  }
  return values;
}

function cleanEmptyValues(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === "" || value === undefined) continue;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const nested = cleanEmptyValues(value as Record<string, unknown>);
      if (Object.keys(nested).length > 0) cleaned[key] = nested;
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export function ApiExplorer({ endpoint, orgContext }: ApiExplorerProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    buildDefaultValues(endpoint.parameters, orgContext),
  );
  const [response, setResponse] = useState<ExplorerResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback((path: string, value: unknown) => {
    setFormData((prev) => {
      const next = { ...prev };
      const parts = path.split(".");
      let current: Record<string, unknown> = next;
      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = { ...(current[parts[i]] as Record<string, unknown> || {}) };
        current = current[parts[i]] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]] = value;
      return next;
    });
  }, []);

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);
    setResponse(null);
    const start = performance.now();

    try {
      const url = `${orgContext.baseUrl}${endpoint.path}`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      if (endpoint.auth.type === "api-key") {
        const headerName = endpoint.auth.header.includes(" ") ? "X-Webhook-Key" : endpoint.auth.header;
        const key = (formData.api_key as string) || orgContext.apiKey || "";
        if (key) headers[headerName] = key;
      }

      const body = cleanEmptyValues(formData);
      const res = await fetch(url, {
        method: endpoint.method,
        headers,
        body: JSON.stringify(body),
      });

      const duration = Math.round(performance.now() - start);
      const resBody = await res.json().catch(() => ({ _raw: "Response is not JSON" }));

      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: resBody,
        duration,
      });
    } catch (err) {
      setError(userMessageOf(err, "Não foi possível enviar a requisição."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-3">
        {endpoint.parameters
          .filter((p) => p.name !== "api_key")
          .map((param) => (
            <ParamField
              key={param.name}
              param={param}
              value={formData[param.name]}
              onChange={(val) => updateField(param.name, val)}
              path={param.name}
              onNestedChange={updateField}
            />
          ))}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={isLoading}
        className="w-full"
        size="sm"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Enviando...
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" />
            Enviar Request
          </>
        )}
      </Button>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/15 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="text-[13px] text-tinta-foreground">{error}</span>
        </div>
      )}

      {response && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {response.status < 400 ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive" />
            )}
            <span className={`text-sm font-mono font-bold ${response.status < 400 ? "text-success" : "text-destructive"}`}>
              {response.status} {response.statusText}
            </span>
            <span className="ml-auto text-[11px] tabular-nums text-tinta-muted">
              {response.duration}ms
            </span>
          </div>
          <JsonBlock data={response.body} label="Response" />
        </div>
      )}
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
  path,
  onNestedChange,
}: {
  param: ApiParam;
  value: unknown;
  onChange: (val: unknown) => void;
  path: string;
  onNestedChange: (path: string, val: unknown) => void;
}) {
  if (param.children) {
    return (
      <div className="space-y-2 border-l border-tinta-line pl-3">
        <Label className="font-mono text-[12px] text-tinta-muted">
          {param.name}
          {param.required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {param.children.map((child) => (
          <ParamField
            key={child.name}
            param={child}
            value={(value as Record<string, unknown>)?.[child.name]}
            onChange={(val) => onNestedChange(`${path}.${child.name}`, val)}
            path={`${path}.${child.name}`}
            onNestedChange={onNestedChange}
          />
        ))}
      </div>
    );
  }

  if (param.type === "boolean") {
    return (
      <div className="flex items-center justify-between">
        <Label className="font-mono text-[12px] text-tinta-muted">
          {param.name}
          {param.required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        <Switch
          checked={!!value}
          onCheckedChange={onChange}
          className="scale-75"
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label className="font-mono text-[12px] text-tinta-muted">
        {param.name}
        {param.required && <span className="ml-1 text-destructive">*</span>}
        <span className="ml-2 text-[10px] font-normal text-tinta-muted/70">{param.type}</span>
      </Label>
      <Input
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.description.slice(0, 60)}
        className="h-8 border-tinta-line bg-tinta-2 font-mono text-[13px] text-tinta-foreground placeholder:text-tinta-muted/70"
      />
    </div>
  );
}
