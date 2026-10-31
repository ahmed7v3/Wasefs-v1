import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WA_AGENT_EVENTS_STREAM } from "@wasfa/shared/schemas/phone";
import { waAgentEventSchema, waAgentRxKey } from "@wasfa/shared/schemas/wa-agent";
import { waRenderDocumentPayloadSchema } from "@wasfa/shared/schemas/wa-document";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { documentRequest } from "../src/documents/data.js";
import { waAgentRenderDocumentJob } from "../src/documents/document.job.js";
import {
  DocumentRenderError,
  TypstRenderer,
  countPdfPages,
  spawnTypst,
  type DocumentRenderer,
  type ExecResult,
  type RenderRequest,
  type TypstExec,
} from "../src/documents/renderer.js";
import { createRxPdf } from "../src/documents/rx-pdf.js";
import { createRxPublisher, type RxPdfPort } from "../src/rx/events.js";

import type { RxResult } from "@wasfa/shared/schemas/rx";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

const NOW = new Date("2026-10-27T10:00:00Z");
const CONVERSATION = "018f0000-0000-7000-8000-0000000000c1";
const RX_ID = "018f0000-0000-7000-8000-0000000000d1";
const KEY_PATTERN = /^wa\/out\/2026\/10\/[0-9a-f-]{36}\.(pdf|png)$/;

const logger = { warn: () => undefined, info: () => undefined } as unknown as Logger;

const pdfWithPages = (pages: number) =>
  Buffer.from(
    `%PDF-1.7\n1 0 obj << /Type /Pages /Count ${String(pages)} >>\n` +
      Array.from({ length: pages }, () => "2 0 obj << /Type /Page /Parent 1 0 R >>\n").join("") +
      "%%EOF",
  );

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "wasfa-doc-test-"));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

const leftovers = async () => (await readdir(work)).filter((name) => name.startsWith("wasfa-doc-"));

const reportPayload = () =>
  waRenderDocumentPayloadSchema.parse({
    conversationId: CONVERSATION,
    template: "report",
    language: "ar",
    fileName: "تقرير",
    content: {
      title: '#panic("x")',
      sections: [{ heading: "h", paragraphs: ["p"] }],
    },
  });

describe("TypstRenderer", () => {
  const renderer = (exec: TypstExec, extra: { maxBytes?: number; maxPages?: number } = {}) =>
    new TypstRenderer({
      bin: "typst",
      fontDir: "/fonts",
      tempRoot: work,
      exec,
      ...extra,
    });
  const request: RenderRequest = { template: "report", format: "pdf", data: { a: "#evil" } };
  const ok = async (cwd: string, bytes: Buffer): Promise<ExecResult> => {
    await writeFile(join(cwd, "out.pdf"), bytes);
    return { code: 0, timedOut: false };
  };

  it("compiles main.typ and data.json in a private directory and removes it", async () => {
    let seen:
      | { args: readonly string[]; cwd: string; files: string[]; data: string; main: string }
      | undefined;
    const out = await renderer(async ({ args, cwd }) => {
      seen = {
        args,
        cwd,
        files: (await readdir(cwd)).sort(),
        data: await readFile(join(cwd, "data.json"), "utf8"),
        main: await readFile(join(cwd, "main.typ"), "utf8"),
      };
      return ok(cwd, pdfWithPages(2));
    }).render(request);

    expect(out.pages).toBe(2);
    expect(seen?.files).toEqual(["data.json", "main.typ"]);
    expect(JSON.parse(seen?.data ?? "")).toEqual({ a: "#evil" });
    // The shared library comes first, then the template; the content is only in data.json.
    expect(seen?.main).toContain("#let doc-header");
    expect(seen?.main).toContain("#doc-title(");
    expect(seen?.main).not.toContain("#evil");
    // Fixed names and the private directory only: nothing a customer wrote is on the command line.
    expect(seen?.args).toEqual([
      "compile",
      "--root",
      seen?.cwd,
      "--font-path",
      "/fonts",
      "--ignore-system-fonts",
      "--format",
      "pdf",
      "main.typ",
      "out.pdf",
    ]);
    expect(await leftovers()).toEqual([]);
  });

  it("asks for a 144 ppi picture for png", async () => {
    let args: readonly string[] = [];
    await renderer(async (invocation) => {
      args = invocation.args;
      await writeFile(join(invocation.cwd, "out.png"), Buffer.from("png"));
      return { code: 0, timedOut: false };
    }).render({ template: "card", format: "png", data: {} });
    expect(args).toContain("--ppi");
    expect(args.at(-1)).toBe("out.png");
  });

  it.each([
    ["timeout", () => Promise.resolve({ code: null, timedOut: true })],
    ["failed", () => Promise.resolve({ code: 1, timedOut: false })],
    ["no_output", () => Promise.resolve({ code: 0, timedOut: false })],
  ] as const)("fails with %s and cleans up", async (code, exec) => {
    await expect(renderer(exec).render(request)).rejects.toMatchObject({ code });
    expect(await leftovers()).toEqual([]);
  });

  it("refuses output over the size limit and over the page limit", async () => {
    await expect(
      renderer(({ cwd }) => ok(cwd, pdfWithPages(1)), { maxBytes: 10 }).render(request),
    ).rejects.toMatchObject({ code: "too_large" });
    await expect(
      renderer(({ cwd }) => ok(cwd, pdfWithPages(31))).render(request),
    ).rejects.toMatchObject({ code: "too_many_pages" });
    await expect(
      renderer(({ cwd }) => ok(cwd, pdfWithPages(30))).render(request),
    ).resolves.toMatchObject({ pages: 30 });
    expect(await leftovers()).toEqual([]);
  });

  it("only renders a template from the fixed list", async () => {
    const exec: TypstExec = () => Promise.reject(new Error("must not run"));
    await expect(
      renderer(exec).render({ ...request, template: "../../etc/passwd" as never }),
    ).rejects.toBeInstanceOf(DocumentRenderError);
  });

  it("counts pages and not the page tree", () => {
    expect(countPdfPages(pdfWithPages(3))).toBe(3);
    expect(countPdfPages(Buffer.from("not a pdf"))).toBe(0);
  });
});

describe("spawnTypst", () => {
  it("kills a process that runs past the timeout", async () => {
    const started = Date.now();
    const result = await spawnTypst({
      bin: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: work,
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("reports the exit code of a process that ends", async () => {
    const result = await spawnTypst({
      bin: process.execPath,
      args: ["-e", "process.exit(3)"],
      cwd: work,
      timeoutMs: 10_000,
    });
    expect(result).toEqual({ code: 3, timedOut: false });
  });
});

describe("document data", () => {
  it("adds the medical notice to a schedule and not to a report", () => {
    const schedule = documentRequest(
      waRenderDocumentPayloadSchema.parse({
        conversationId: CONVERSATION,
        template: "schedule",
        language: "en",
        fileName: "plan",
        content: { title: "t", rows: [{ medicine: "m", dose: "d", times: ["8:00"] }] },
      }),
      NOW,
    );
    expect(schedule.data["disclaimer"]).toMatchObject({
      text: "General information to help you. It does not replace a doctor or pharmacist.",
    });
    expect(documentRequest(reportPayload(), NOW).data).not.toHaveProperty("disclaimer");
  });

  it("stamps the brand and the Cairo date", () => {
    const { data, format } = documentRequest(reportPayload(), new Date("2026-10-27T22:30:00Z"));
    expect(format).toBe("pdf");
    expect(data).toMatchObject({ lang: "ar", brand: "وصفة AI", site: "wasfa.online" });
    // 22:30 UTC is already the next day in Cairo.
    expect(String(data["generatedOn"])).toContain("2026-10-28");
  });
});

class FakeRedis {
  readonly stream: unknown[] = [];
  readonly keys = new Set<string>();
  failXadd = false;
  incr = () => Promise.resolve(1);
  expire = () => Promise.resolve(1);
  set = () => Promise.resolve("OK");
  publish = () => Promise.resolve(1);
  exists = (key: string) => Promise.resolve(this.keys.has(key) ? 1 : 0);
  xadd = (stream: string, ...args: string[]) => {
    if (this.failXadd) return Promise.reject(new Error("redis down"));
    expect(stream).toBe(WA_AGENT_EVENTS_STREAM);
    this.stream.push(JSON.parse(args.at(-1) ?? "null"));
    return Promise.resolve("1-0");
  };
}

class FakeStorage {
  readonly objects = new Map<string, { bytes: Buffer; type: string }>();
  put = (key: string, bytes: Buffer, type: string) => {
    this.objects.set(key, { bytes, type });
    return Promise.resolve();
  };
  remove = (key: string) => {
    this.objects.delete(key);
    return Promise.resolve();
  };
}

const fakeRenderer = (result: Buffer | Error): DocumentRenderer & { requests: RenderRequest[] } => {
  const requests: RenderRequest[] = [];
  return {
    requests,
    render: (request) => {
      requests.push(request);
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve({ bytes: result, pages: 1 });
    },
  };
};

describe("wa-agent.render-document job", () => {
  const run = (
    payload: ReturnType<typeof reportPayload>,
    redis: FakeRedis,
    storage: FakeStorage,
    documents: DocumentRenderer,
  ) =>
    waAgentRenderDocumentJob(
      payload,
      {
        redis: redis as unknown as Redis,
        logger,
        storage: storage as never,
        documents,
      },
      NOW,
    );

  it("stores the PDF under wa/out and pushes document_ready", async () => {
    const redis = new FakeRedis();
    const storage = new FakeStorage();
    const documents = fakeRenderer(Buffer.from("%PDF-"));
    await run(reportPayload(), redis, storage, documents);

    const [key] = [...storage.objects.keys()];
    expect(key).toMatch(KEY_PATTERN);
    expect(storage.objects.get(key ?? "")?.type).toBe("application/pdf");
    expect(documents.requests[0]?.template).toBe("report");
    const event = waAgentEventSchema.parse(redis.stream[0]);
    expect(event).toEqual({
      type: "document_ready",
      conversationId: CONVERSATION,
      mediaKey: key,
      fileName: "تقرير.pdf",
      kind: "document",
    });
  });

  it("sends a card as an image", async () => {
    const redis = new FakeRedis();
    const storage = new FakeStorage();
    await run(
      waRenderDocumentPayloadSchema.parse({
        conversationId: CONVERSATION,
        template: "card",
        language: "ar",
        fileName: "card",
        content: { title: "t", lines: ["l"] },
      }),
      redis,
      storage,
      fakeRenderer(Buffer.from("png")),
    );
    expect(redis.stream[0]).toMatchObject({ kind: "image", fileName: "card.png" });
    expect([...storage.objects.values()][0]?.type).toBe("image/png");
  });

  it("pushes document_failed and stores nothing when the render fails", async () => {
    const redis = new FakeRedis();
    const storage = new FakeStorage();
    await run(reportPayload(), redis, storage, fakeRenderer(new DocumentRenderError("timeout")));
    expect(redis.stream).toEqual([{ type: "document_failed", conversationId: CONVERSATION }]);
    expect(storage.objects.size).toBe(0);
  });

  it("removes the object when the ready event cannot be pushed", async () => {
    const redis = new FakeRedis();
    redis.failXadd = true;
    const storage = new FakeStorage();
    await expect(
      run(reportPayload(), redis, storage, fakeRenderer(Buffer.from("%PDF-"))),
    ).rejects.toThrow("redis down");
    expect(storage.objects.size).toBe(0);
  });
});

describe("rx PDF on rx_done", () => {
  const result = {
    items: [
      {
        rawText: "Augmentin",
        name: "Augmentin",
        strength: "1 g",
        form: null,
        dose: "1",
        frequency: null,
        duration: null,
        badge: "low",
        verified: "unreadable",
      },
    ],
    date: null,
    unreadableRegions: [],
  } as unknown as RxResult;

  const agentRedis = () => {
    const redis = new FakeRedis();
    redis.keys.add(waAgentRxKey(RX_ID));
    return redis;
  };

  it("adds the key of the rendered PDF to the event", async () => {
    const redis = agentRedis();
    const pdf: RxPdfPort = {
      render: () => Promise.resolve(`wa/out/2026/10/${CONVERSATION}.pdf`),
      discard: () => Promise.resolve(),
    };
    await createRxPublisher(redis as unknown as Redis, RX_ID, logger, pdf).done("done", result);
    expect(waAgentEventSchema.parse(redis.stream[0])).toEqual({
      type: "rx_done",
      rxId: RX_ID,
      pdfKey: `wa/out/2026/10/${CONVERSATION}.pdf`,
    });
  });

  it("still sends the text result when the PDF fails", async () => {
    const redis = agentRedis();
    const pdf: RxPdfPort = {
      render: () => Promise.reject(new Error("typst missing")),
      discard: () => Promise.resolve(),
    };
    await createRxPublisher(redis as unknown as Redis, RX_ID, logger, pdf).done("done", result);
    expect(redis.stream).toEqual([{ type: "rx_done", rxId: RX_ID }]);
  });

  it("does not render for a web analysis and removes a PDF that no event points to", async () => {
    let rendered = 0;
    const discarded: string[] = [];
    const pdf: RxPdfPort = {
      render: () => {
        rendered += 1;
        return Promise.resolve("wa/out/2026/10/x.pdf");
      },
      discard: (key) => {
        discarded.push(key);
        return Promise.resolve();
      },
    };
    const web = new FakeRedis();
    await createRxPublisher(web as unknown as Redis, RX_ID, logger, pdf).done("done", result);
    expect(rendered).toBe(0);

    const broken = agentRedis();
    broken.failXadd = true;
    await createRxPublisher(broken as unknown as Redis, RX_ID, logger, pdf).done("done", result);
    expect(discarded).toEqual(["wa/out/2026/10/x.pdf"]);
  });

  it("createRxPdf stores a wa/out PDF and gives null on failure", async () => {
    const storage = new FakeStorage();
    const documents = fakeRenderer(Buffer.from("%PDF-"));
    const deps = {
      documents,
      storage: storage as never,
      logger,
      language: () => Promise.resolve("en" as const),
      link: (id: string) => `https://wasfa.online/analyze/${id}`,
    };
    const key = await createRxPdf(RX_ID, deps).render(result);
    expect(key).toMatch(KEY_PATTERN);
    expect(documents.requests[0]).toMatchObject({ template: "rx_result", format: "pdf" });
    const doc = (documents.requests[0]?.data["doc"] ?? {}) as {
      items: { flag: string | null }[];
      link: string;
    };
    // A doubtful line is flagged, never presented as certain.
    expect(doc.items[0]?.flag).toContain("uncertain reading");
    expect(doc.link).toBe(`https://wasfa.online/analyze/${RX_ID}`);
    expect(documents.requests[0]?.data["disclaimer"]).toBeDefined();

    const failing = createRxPdf(RX_ID, { ...deps, documents: fakeRenderer(new Error("boom")) });
    expect(await failing.render(result)).toBeNull();
  });
});
