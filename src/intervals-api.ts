export type IntervalsResource = "client" | "project" | "projectworktype" | "projectmodule" | "timer" | "time";

export class IntervalsApiClient {
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch }) {}

  async listResource(resource: IntervalsResource): Promise<unknown[]> {
    const data = await this.request("GET", resource);
    return extractCollection(data, resource);
  }

  async createResource(resource: "timer" | "time", body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", resource, body);
  }

  async updateResource(resource: "timer" | "time", id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", `${resource}/${id}`, body);
  }

  private async request(method: string, resourcePath: string, body?: Record<string, unknown>): Promise<unknown> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const base = this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`;
    const url = new URL(resourcePath.endsWith("/") ? resourcePath : `${resourcePath}/`, base).toString();
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${this.options.apiKey}:X`).toString("base64")}`,
    };
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new Error(sanitizeApiError(text || `${response.status} ${response.statusText}`, this.options.apiKey));
    return data;
  }
}

export function extractCollection(data: unknown, resource: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>;
    for (const key of [resource, `${resource}s`, "items", "data"]) {
      if (Array.isArray(object[key])) return object[key];
    }
  }
  return [];
}

export function sanitizeApiError(message: string, apiKey?: string): string {
  let clean = message.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [redacted]");
  if (apiKey) clean = clean.split(apiKey).join("[redacted]");
  return clean;
}
