import { ApiEndpointHeader } from "./ApiEndpointHeader";
import { ApiAuthSection } from "./ApiAuthSection";
import { ApiParamsTable } from "./ApiParamsTable";
import { ApiNotesSection } from "./ApiNotesSection";
import type { ApiEndpoint } from "@/lib/api-docs/types";

interface ApiDocsContentProps {
  endpoint: ApiEndpoint;
  baseUrl: string;
}

export function ApiDocsContent({ endpoint, baseUrl }: ApiDocsContentProps) {
  return (
    <div className="space-y-8 p-6 overflow-y-auto">
      <ApiEndpointHeader endpoint={endpoint} baseUrl={baseUrl} />

      <div className="border-t border-border" />

      <ApiAuthSection endpoint={endpoint} />

      <div className="border-t border-border" />

      <ApiParamsTable params={endpoint.parameters} title="Parametros do Request" />

      {endpoint.responseFields.length > 0 && (
        <>
          <div className="border-t border-border" />
          <ApiParamsTable params={endpoint.responseFields} title="Campos do Response" />
        </>
      )}

      {endpoint.notes && endpoint.notes.length > 0 && (
        <>
          <div className="border-t border-border" />
          <ApiNotesSection notes={endpoint.notes} />
        </>
      )}
    </div>
  );
}
