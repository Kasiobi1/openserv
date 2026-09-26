export interface ApiResult { status: number; body: any }

export class BackendClient {
  constructor(readonly base: string) {}

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch {
      throw new Error(`cannot reach the backend at ${this.base}. Start it in another terminal with: npm run dev`);
    }
  }

  config = () => this.request("GET", "/config");
  jobs = async () => (await this.request("GET", "/jobs")).body as any[];
  job = (id: string) => this.request("GET", `/jobs/${encodeURIComponent(id)}`);
  postJob = (spec: unknown, provider: string) => this.request("POST", "/jobs", { spec, provider });
  submit = (id: string, submission: unknown) => this.request("POST", `/jobs/${encodeURIComponent(id)}/submissions`, submission);
  verify = (id: string) => this.request("POST", `/jobs/${encodeURIComponent(id)}/verify`);
  settle = (id: string) => this.request("POST", `/jobs/${encodeURIComponent(id)}/settle`);
  leaderboard = async () => (await this.request("GET", "/providers/leaderboard")).body as any[];
}
