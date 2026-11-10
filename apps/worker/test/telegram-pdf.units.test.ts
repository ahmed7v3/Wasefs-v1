import { UnrecoverableError } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_RX_RESULT } from "../src/documents/fixtures.js";
import { telegramRxPdfJob } from "../src/documents/telegram-pdf.job.js";
import { findAnalysis } from "../src/rx/repo.js";

import type { DocumentRenderer, RenderRequest } from "../src/documents/renderer.js";
import type { JobContext } from "../src/queues.js";
import type { Logger } from "pino";

vi.mock("../src/rx/repo.js", () => ({ findAnalysis: vi.fn() }));

const RX_ID = "018f0000-0000-7000-8000-0000000000d1";
const KEY_PATTERN = /^wa\/out\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/;
/** What the pipeline stores: the render fixture plus the fields only a stored reading carries. */
const STORED_RESULT = {
  ...SAMPLE_RX_RESULT,
  schemaVersion: 1,
  date: null,
  prescriberLegible: true,
  findings: [],
  matching: "model",
  unreadableRegions: [],
  // The last fixture line has no strength, form or duration; a stored reading always has them.
  items: SAMPLE_RX_RESULT.items.map((item) =>
    Object.assign({ strength: "", form: "", duration: "" }, item, { box_2d: null, page: 0 }),
  ),
};

const logger = { warn: vi.fn(), info: vi.fn() } as unknown as Logger;

function setup(render: DocumentRenderer["render"]) {
  const requests: RenderRequest[] = [];
  const documents: DocumentRenderer = {
    render: (request) => {
      requests.push(request);
      return render(request);
    },
  };
  const objects = new Map<string, string>();
  const storage = {
    put: vi.fn((key: string, _bytes: Buffer, type: string) => {
      objects.set(key, type);
      return Promise.resolve();
    }),
    remove: vi.fn(() => Promise.resolve()),
  };
  const context = {
    db: {},
    logger,
    storage,
    documents,
    env: { WEB_ORIGIN: "https://wasfa.online" },
  } as unknown as JobContext;
  return { requests, objects, context };
}

const ok = () => Promise.resolve({ bytes: Buffer.from("%PDF-"), pages: 1 });

describe("telegram.rx-pdf job", () => {
  beforeEach(() => {
    vi.mocked(findAnalysis).mockReset();
  });

  it("renders the finished analysis in the requested language and returns the storage key", async () => {
    vi.mocked(findAnalysis).mockResolvedValue({
      id: RX_ID,
      status: "done",
      result: STORED_RESULT,
    } as never);
    const { requests, objects, context } = setup(ok);

    const key = await telegramRxPdfJob({ analysisId: RX_ID, locale: "en" }, context);

    expect(key).toMatch(KEY_PATTERN);
    expect(objects.get(key)).toBe("application/pdf");
    expect(requests[0]).toMatchObject({ template: "rx_result", format: "pdf" });
    expect(requests[0]?.data["lang"]).toBe("en");

    const arabic = setup(ok);
    await telegramRxPdfJob({ analysisId: RX_ID, locale: "ar" }, arabic.context);
    expect(arabic.requests[0]?.data["lang"]).toBe("ar");
  });

  it("never retries an analysis that is missing or not done", async () => {
    const { context } = setup(ok);
    vi.mocked(findAnalysis).mockResolvedValueOnce(null);
    await expect(
      telegramRxPdfJob({ analysisId: RX_ID, locale: "ar" }, context),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    vi.mocked(findAnalysis).mockResolvedValueOnce({ id: RX_ID, status: "processing" } as never);
    await expect(
      telegramRxPdfJob({ analysisId: RX_ID, locale: "ar" }, context),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("fails (so the api can say so) when the renderer fails", async () => {
    vi.mocked(findAnalysis).mockResolvedValue({
      id: RX_ID,
      status: "done",
      result: STORED_RESULT,
    } as never);
    const { context } = setup(() => Promise.reject(new Error("typst down")));
    await expect(telegramRxPdfJob({ analysisId: RX_ID, locale: "ar" }, context)).rejects.toThrow(
      "pdf_render_failed",
    );
  });
});
