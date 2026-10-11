import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";

import {
  STACK_PORTS,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
  WHATSAPP_NUMBER,
  originOf,
  type StackName,
} from "./config";

/*
 * Boots the real stack for the end-to-end suite: Postgres 18 and Redis 8 (Testcontainers), the
 * built API and worker, and `next start`. Everything is a child process with its output in
 * `e2e/.logs/`, so a failure leaves something to read. `pnpm build` must have run first (API,
 * worker, db and shared come from their `dist`); the web app is built here because its
 * NEXT_PUBLIC_* values (API URL, Turnstile key) are baked in at build time.
 */

export const WEB_DIR = fileURLToPath(new URL("../../", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const LOG_DIR = `${WEB_DIR}e2e/.logs`;
const API_DIR = `${REPO_ROOT}apps/api`;
const WORKER_DIR = `${REPO_ROOT}apps/worker`;
const DB_DIR = `${REPO_ROOT}packages/db`;
/** A file URL: on Windows `node --import` rejects a bare `C:\...` path. */
const API_PRELOAD = new URL("./api-preload.mjs", import.meta.url).href;

const API_DB_PASSWORD = "e2e-api-role-password";

export interface RuntimeInfo {
  redisUrl: string;
  /** Owner role: used for migrations and the admin bootstrap only. */
  ownerDatabaseUrl: string;
  stacks: Partial<Record<StackName, { web: string; api: string }>>;
}

interface Infra {
  ownerDatabaseUrl: string;
  apiDatabaseUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

/** Variables that would leak a developer's shell configuration into the services under test. */
const STRIPPED_ENV =
  /^(GOOGLE_|FACEBOOK_|TURNSTILE_|AUTH_|SMTP_|NEXT_PUBLIC_|NEXT_DIST|CSP_|WHATSAPP_|API_|WEB_|DATABASE_|REDIS_|TRUST_|ENCRYPTION_|BETTER_AUTH|MAIL_|WORKER_|RATE_LIMIT|PORT$|HOST$|HOSTNAME$|LOG_LEVEL$|NODE_ENV$)/;

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED_ENV.test(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

function logPath(name: string): string {
  mkdirSync(LOG_DIR, { recursive: true });
  return `${LOG_DIR}/${name}.log`;
}

function tail(name: string, lines = 40): string {
  try {
    return readFileSync(logPath(name), "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

async function startInfra(): Promise<Infra> {
  const [postgres, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer("postgres:18-alpine").start(),
    new RedisContainer("redis:8-alpine").start(),
  ]);
  const ownerDatabaseUrl = postgres.getConnectionUri();
  const apiUrl = new URL(ownerDatabaseUrl);
  // The API connects as the restricted role it has in production (no UPDATE/DELETE on audit_logs).
  apiUrl.username = "wasfa_api";
  apiUrl.password = API_DB_PASSWORD;
  return {
    ownerDatabaseUrl,
    apiDatabaseUrl: apiUrl.toString(),
    redisUrl: redis.getConnectionUrl(),
    stop: async () => {
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}

function runToCompletion(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): void {
  const fd = openSync(logPath(name), "w");
  try {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", fd, fd],
    });
    if (result.status !== 0) {
      throw new Error(`${name} failed (exit ${String(result.status)}):\n${tail(name)}`);
    }
  } finally {
    closeSync(fd);
  }
}

function prepareDatabase(infra: Infra): void {
  const env = cleanEnv({
    DATABASE_URL: infra.ownerDatabaseUrl,
    API_DB_PASSWORD,
  });
  // The db package's own entry points: the same migrate and seed steps as production's `migrate` container.
  for (const script of ["migrate", "seed"]) {
    runToCompletion(`db-${script}`, process.execPath, [`dist/${script}.js`], {
      cwd: DB_DIR,
      env,
    });
  }
}

function distDirOf(name: StackName): string {
  return `.next-e2e-${name}`;
}

function buildWeb(name: StackName, env: Record<string, string>): void {
  const dist = distDirOf(name);
  if (process.env["E2E_REUSE_BUILD"] === "1" && existsSync(`${WEB_DIR}${dist}/BUILD_ID`)) return;
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const run = () =>
    runToCompletion(`web-build-${name}`, process.execPath, [nextBin, "build"], {
      cwd: WEB_DIR,
      env: cleanEnv({ ...env, NEXT_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: "1" }),
    });
  try {
    run();
  } catch {
    // The build downloads Google fonts; that download fails now and then ("next/font/google
    // queries have exactly one entry"). One more attempt tells a flake from a broken build.
    run();
  }
}

interface Service {
  name: string;
  process: ChildProcess;
}

function startService(
  name: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Service {
  const fd = openSync(logPath(name), "w");
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  return { name, process: child };
}

async function waitFor(
  what: string,
  service: Service,
  ready: () => Promise<boolean>,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.process.exitCode !== null) {
      throw new Error(
        `${service.name} exited early (${String(service.process.exitCode)}):\n${tail(service.name)}`,
      );
    }
    if (await ready().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} was not ready after ${String(timeoutMs)} ms:\n${tail(service.name)}`);
}

const answers = (url: string) => async (): Promise<boolean> => (await fetch(url)).ok;

function stopService(service: Service): void {
  const { pid } = service.process;
  if (pid === undefined || service.process.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    service.process.kill("SIGTERM");
  }
}

export interface RunningStack {
  runtime: RuntimeInfo;
  stop: () => Promise<void>;
}

/**
 * Starts the default stack (Turnstile off) and, unless `withTurnstile` is false, a second API+web
 * pair with Cloudflare's always-pass test keys. They share the containers and the worker.
 */
export async function startStack(options: { withTurnstile: boolean }): Promise<RunningStack> {
  const services: Service[] = [];
  const infraPromise = startInfra();
  const names: StackName[] = options.withTurnstile ? ["default", "turnstile"] : ["default"];

  const encryptionKey = randomBytes(32).toString("base64");
  const authSecret = randomBytes(32).toString("base64");

  const webBuildEnv = (name: StackName): Record<string, string> => ({
    NEXT_PUBLIC_ENV: "development",
    NEXT_PUBLIC_SITE_URL: originOf(STACK_PORTS[name].web),
    NEXT_PUBLIC_API_URL: originOf(STACK_PORTS[name].api),
    ...(name === "turnstile" ? { NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY } : {}),
  });

  let infra: Infra | undefined;
  try {
    // Containers pull and start while the (slow) web builds run.
    infra = await infraPromise;
    const running = infra;
    prepareDatabase(running);

    for (const name of names) buildWeb(name, webBuildEnv(name));

    const worker = startService("worker", ["dist/main.js"], {
      cwd: WORKER_DIR,
      env: cleanEnv({
        NODE_ENV: "test",
        DATABASE_URL: running.apiDatabaseUrl,
        REDIS_URL: running.redisUrl,
        ENCRYPTION_KEY: encryptionKey,
        LOG_LEVEL: "info",
      }),
    });
    services.push(worker);

    for (const name of names) {
      const ports = STACK_PORTS[name];
      const api = startService(`api-${name}`, ["--import", API_PRELOAD, "dist/main.js"], {
        cwd: API_DIR,
        env: cleanEnv({
          NODE_ENV: "test",
          HOST: "0.0.0.0",
          PORT: String(ports.api),
          DATABASE_URL: running.apiDatabaseUrl,
          REDIS_URL: running.redisUrl,
          WEB_ORIGIN: originOf(ports.web),
          API_PUBLIC_URL: originOf(ports.api),
          ENCRYPTION_KEY: encryptionKey,
          BETTER_AUTH_SECRET: authSecret,
          ARGON2_MEMORY_KIB: "8192",
          // Every request comes from 127.0.0.1; the per-route auth limits stay as they are in
          // production and are reset between tests, only the global per-IP ceiling is lifted.
          RATE_LIMIT_MAX: "100000",
          LOG_LEVEL: "warn",
          WHATSAPP_NUMBER,
          ...(name === "turnstile" ? { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY } : {}),
        }),
      });
      services.push(api);

      const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
      const web = startService(`web-${name}`, [nextBin, "start", "--port", String(ports.web)], {
        cwd: WEB_DIR,
        env: cleanEnv({
          ...webBuildEnv(name),
          NODE_ENV: "production",
          NEXT_DIST_DIR: distDirOf(name),
          NEXT_TELEMETRY_DISABLED: "1",
          API_INTERNAL_URL: originOf(ports.api),
        }),
      });
      services.push(web);

      await waitFor("the API", api, answers(`${originOf(ports.api)}/health/live`));
      await waitFor("the web app", web, answers(`${originOf(ports.web)}/healthz`));
    }

    await waitFor("the worker", worker, () =>
      Promise.resolve(tail("worker", 200).includes("Worker started")),
    );

    const runtime: RuntimeInfo = {
      redisUrl: running.redisUrl,
      ownerDatabaseUrl: running.ownerDatabaseUrl,
      stacks: Object.fromEntries(
        names.map((name) => [
          name,
          { web: originOf(STACK_PORTS[name].web), api: originOf(STACK_PORTS[name].api) },
        ]),
      ),
    };
    return {
      runtime,
      stop: async () => {
        for (const service of services.reverse()) stopService(service);
        await running.stop();
      },
    };
  } catch (error) {
    for (const service of services) stopService(service);
    await infra?.stop().catch(() => undefined);
    throw error;
  }
}
