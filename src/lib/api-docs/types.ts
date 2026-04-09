export interface ApiParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  children?: ApiParam[];
}

export interface ApiEndpoint {
  id: string;
  name: string;
  description: string;
  category: "webhooks" | "internal" | "leads";
  version: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  auth: {
    type: "api-key" | "bearer" | "none";
    header: string;
    description: string;
  };
  parameters: ApiParam[];
  requestExample: Record<string, unknown>;
  responseExample: Record<string, unknown>;
  responseFields: ApiParam[];
  notes?: string[];
  rateLimits?: string;
  deprecated?: boolean;
  deprecation_notice?: string;
  sunset_date?: string;
}

export interface ApiCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  endpoints: ApiEndpoint[];
}
