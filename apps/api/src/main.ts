import { createApp } from "./bootstrap.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = await createApp(env);
// On SIGTERM Nest closes Fastify (draining in-flight requests), then the DB pool and Redis.
await app.listen({ host: env.HOST, port: env.PORT });
