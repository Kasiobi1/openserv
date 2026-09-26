import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { DomainError } from "./services/errors";
import type { JobService } from "./services/jobs";

export interface ServerOptions {
  /** Allowed CORS origins. Omit for any origin. */
  corsOrigins?: string[];
  /** Public, non-secret settings the dashboard needs (chain, explorer, policy). */
  publicConfig?: Record<string, unknown>;
}

export function buildServer(jobs: JobService, opts: ServerOptions = {}) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: opts.corsOrigins?.length ? opts.corsOrigins : true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: "validation_failed", issues: err.issues });
    if (err instanceof DomainError) return reply.status(err.status).send({ error: err.message });
    return reply.status(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/config", async () => ({ ...opts.publicConfig, autoPipeline: jobs.autoPipeline }));

  // Buyer posts a job. Body: { spec: JobSpec, provider: "0x..." }
  app.post("/jobs", async (req, reply) => {
    const body = req.body as { spec?: unknown; provider?: string };
    if (!body?.spec || typeof body.provider !== "string") throw new DomainError(400, "body must be { spec, provider }");
    const { job, decision } = await jobs.createJob(body.spec, body.provider);
    return reply.status(decision.allowed ? 201 : 403).send({ job, decision });
  });

  app.get("/jobs", async () => jobs.listJobs());
  app.get<{ Params: { id: string } }>("/jobs/:id", async (req) => jobs.getJobDetail(req.params.id));

  app.post<{ Params: { id: string } }>("/jobs/:id/submissions", async (req, reply) =>
    reply.status(201).send(await jobs.submit(req.params.id, req.body)),
  );
  app.post<{ Params: { id: string } }>("/jobs/:id/verify", async (req) => jobs.verify(req.params.id));
  app.post<{ Params: { id: string } }>("/jobs/:id/settle", async (req, reply) => {
    const r = await jobs.settle(req.params.id);
    return reply.status(r.decision.allowed ? 200 : 422).send(r);
  });

  app.get("/providers/leaderboard", async () => jobs.leaderboard());
  app.get<{ Params: { address: string } }>("/providers/:address", async (req) => jobs.providerScore(req.params.address));

  return app;
}
