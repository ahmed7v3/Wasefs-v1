// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import {
  type DrugView,
  type ImportReport,
  type ImportView,
} from "@wasfa/shared/schemas/admin-drugs";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrugImportsView } from "../src/components/admin/drug-imports-view";
import { DrugsView } from "../src/components/admin/drugs-view";
import { api } from "../src/lib/api-client";
import {
  draftFrom,
  duplicateFields,
  isRunning,
  mappingFrom,
  presetDraft,
  progressPercent,
  sameMapping,
} from "../src/lib/drug-admin";
import { ReauthProvider } from "../src/lib/reauth";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const DRUG_ID = "22222222-2222-4222-8222-222222222222";

let search = "";
const replace = vi.fn((href: string) => {
  search = href.includes("?") ? (href.split("?")[1] ?? "") : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/admin/drugs/imports",
  useSearchParams: () => new URLSearchParams(search),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  search = "";
  replace.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const callsTo = (method: string, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith(suffix) && (init?.method ?? "GET") === method,
  );

describe("drug import helpers", () => {
  const headers = ["Trade Name", "Strength", "Internal code"];

  it("builds a draft from a preset and turns it back into a mapping", () => {
    const draft = presetDraft("sfda", headers);
    expect(draft).toEqual({ "Trade Name": "brandEn", Strength: "strength", "Internal code": "" });
    expect(mappingFrom(draft)).toEqual({ "Trade Name": "brandEn", Strength: "strength" });
  });

  it("finds a field claimed twice and compares with the mapping a dry run used", () => {
    const draft = draftFrom(headers, { "Trade Name": "brandEn" });
    expect(duplicateFields({ ...draft, Strength: "brandEn" })).toEqual(["brandEn"]);
    expect(sameMapping(draft, { "Trade Name": "brandEn" })).toBe(true);
    expect(sameMapping({ ...draft, Strength: "strength" }, { "Trade Name": "brandEn" })).toBe(
      false,
    );
  });

  it("computes progress", () => {
    const base = { mode: "commit", error: null } as const;
    expect(isRunning(null)).toBe(false);
    expect(isRunning({ ...base, phase: "queued", done: 0, total: 0 })).toBe(true);
    expect(isRunning({ ...base, phase: "done", done: 5, total: 5 })).toBe(false);
    expect(progressPercent({ ...base, phase: "running", done: 0, total: 0 })).toBe(0);
    expect(progressPercent({ ...base, phase: "running", done: 5_000, total: 20_000 })).toBe(25);
    expect(progressPercent({ ...base, phase: "done", done: 1, total: 3 })).toBe(100);
  });
});

describe("api client uploads", () => {
  it("sends FormData as is, without a JSON content type", async () => {
    fetchMock.mockResolvedValue(json({}));
    const body = new FormData();
    body.append("source", "eda");
    await api("/admin/drugs/imports", { method: "POST", body });
    const init = fetchMock.mock.calls.at(-1)?.[1];
    expect(init?.body).toBe(body);
    expect(init?.headers).not.toHaveProperty("Content-Type");
  });
});

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  const row = (n: number, status: "new" | "updated" | "duplicate" | "invalid") => ({
    row: n,
    status,
    reason: status === "invalid" ? "missing_name" : status === "duplicate" ? "unchanged" : null,
    brandEn: status === "invalid" ? "" : `Drug ${String(n)}`,
    brandAr: null,
    strength: "500 mg",
    form: "tablet",
    ingredients: [],
    changes: status === "updated" ? ["manufacturer"] : [],
  });
  return {
    mode: "dry_run",
    generatedAt: "2026-10-12T08:00:00.000Z",
    headers: ["Trade Name", "Strength", "Internal code"],
    mapping: { "Trade Name": "brandEn", Strength: "strength" },
    counts: { total: 4, new: 1, updated: 1, duplicate: 1, invalid: 1 },
    reasons: { missing_name: 1, unchanged: 1 },
    preview: [row(2, "new"), row(3, "updated"), row(4, "duplicate"), row(5, "invalid")],
    samples: {
      new: [row(2, "new")],
      updated: [row(3, "updated")],
      duplicate: [row(4, "duplicate")],
      invalid: [row(5, "invalid")],
    },
    ...overrides,
  };
}

function importView(overrides: Partial<ImportView> = {}): ImportView {
  return {
    id: BATCH_ID,
    fileName: "eda.xlsx",
    source: "eda",
    mapping: { "Trade Name": "brandEn", Strength: "strength" },
    status: "dry_run",
    rowsTotal: 4,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    committedAt: null,
    rolledBackAt: null,
    createdAt: "2026-10-12T08:00:00.000Z",
    progress: { mode: "dry_run", phase: "done", done: 4, total: 4, error: null },
    fileAvailable: true,
    report: report(),
    ...overrides,
  };
}

function renderImports(canWrite = true) {
  return render(
    <ToastProvider>
      <ReauthProvider>
        <DrugImportsView canWrite={canWrite} />
      </ReauthProvider>
    </ToastProvider>,
  );
}

function serve(view: () => ImportView) {
  fetchMock.mockImplementation((url, init) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.endsWith("/admin/drugs/imports") && method === "GET") {
      return Promise.resolve(json({ items: [{ ...view(), report: undefined }] }));
    }
    if (path.endsWith(`/admin/drugs/imports/${BATCH_ID}`) && method === "GET") {
      return Promise.resolve(json(view()));
    }
    return Promise.resolve(json(view()));
  });
}

describe("DrugImportsView", () => {
  it("shows the counts, the preview rows and the mapping of a finished dry run", async () => {
    search = `import=${BATCH_ID}`;
    serve(() => importView());
    renderImports();

    expect(await screen.findByText(t("admin.drugs.imports.report.title"))).toBeTruthy();
    const counts = screen.getAllByText(t("admin.drugs.imports.count.invalid"));
    expect(counts.length).toBeGreaterThan(0);
    expect(screen.getByText("Drug 2")).toBeTruthy();
    expect(
      screen.getAllByText(t("admin.drugs.imports.reason.missing_name"), { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText<HTMLSelectElement>("Trade Name").value).toBe("brandEn");
    expect(screen.getByLabelText<HTMLSelectElement>("Internal code").value).toBe("");
    expect(
      screen.getByRole("button", { name: t("admin.drugs.imports.commit.button") }),
    ).toHaveProperty("disabled", false);
  });

  it("switches the row group and says which fields an update changes", async () => {
    search = `import=${BATCH_ID}`;
    serve(() => importView());
    renderImports();
    await screen.findByText(t("admin.drugs.imports.report.title"));

    await userEvent.click(
      screen.getByRole("button", { name: t("admin.drugs.imports.view.updated") }),
    );
    expect(
      await screen.findByText(
        t("admin.drugs.imports.row.changes", {
          fields: t("admin.drugs.imports.row.field.manufacturer"),
        }),
      ),
    ).toBeTruthy();
  });

  it("blocks the commit while the edited mapping differs from the last dry run, and re-runs with it", async () => {
    search = `import=${BATCH_ID}`;
    serve(() => importView());
    renderImports();
    await screen.findByText(t("admin.drugs.imports.report.title"));

    await userEvent.selectOptions(screen.getByLabelText("Internal code"), "manufacturer");
    expect(
      screen.getByRole("button", { name: t("admin.drugs.imports.commit.button") }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText(t("admin.drugs.imports.commit.disabledStale"))).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: t("admin.drugs.imports.mapping.rerun") }),
    );
    await waitFor(() => {
      expect(callsTo("POST", `/admin/drugs/imports/${BATCH_ID}/dry-run`)).toHaveLength(1);
    });
    const body = JSON.parse(
      String(callsTo("POST", `/admin/drugs/imports/${BATCH_ID}/dry-run`)[0]?.[1]?.body),
    ) as { mapping: Record<string, string> };
    expect(body.mapping).toEqual({
      "Trade Name": "brandEn",
      Strength: "strength",
      "Internal code": "manufacturer",
    });
  });

  it("refuses the same field for two columns", async () => {
    search = `import=${BATCH_ID}`;
    serve(() => importView());
    renderImports();
    await screen.findByText(t("admin.drugs.imports.report.title"));
    await userEvent.selectOptions(screen.getByLabelText("Strength"), "brandEn");
    expect(screen.getAllByText(t("admin.drugs.imports.mapping.duplicate")).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByRole("button", { name: t("admin.drugs.imports.mapping.rerun") }),
    ).toHaveProperty("disabled", true);
  });

  it("commits after confirmation", async () => {
    search = `import=${BATCH_ID}`;
    serve(() => importView());
    renderImports();
    await screen.findByText(t("admin.drugs.imports.report.title"));

    await userEvent.click(
      screen.getByRole("button", { name: t("admin.drugs.imports.commit.button") }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: t("admin.drugs.imports.commit.confirmTitle", { file: "eda.xlsx" }),
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.drugs.imports.commit.button") }),
    );
    await waitFor(() => {
      expect(callsTo("POST", `/admin/drugs/imports/${BATCH_ID}/commit`)).toHaveLength(1);
    });
  });

  it("shows a progress bar while a job runs", async () => {
    search = `import=${BATCH_ID}`;
    serve(() =>
      importView({
        status: "dry_run",
        progress: { mode: "commit", phase: "running", done: 5_000, total: 20_000, error: null },
      }),
    );
    renderImports();
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    // No commit while a job is running.
    expect(
      screen.getByRole("button", { name: t("admin.drugs.imports.commit.button") }),
    ).toHaveProperty("disabled", true);
  });

  it("offers rollback for a saved batch and explains what it keeps", async () => {
    search = `import=${BATCH_ID}`;
    serve(() =>
      importView({
        status: "committed",
        rowsInserted: 1,
        rowsUpdated: 1,
        report: report({ mode: "commit" }),
      }),
    );
    renderImports();
    await screen.findByText(t("admin.drugs.imports.report.titleCommitted"));
    expect(screen.queryByLabelText("Trade Name")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: t("admin.drugs.imports.rollback.button") }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.drugs.imports.rollback.confirm") }),
    );
    await waitFor(() => {
      expect(callsTo("POST", `/admin/drugs/imports/${BATCH_ID}/rollback`)).toHaveLength(1);
    });
  });

  it("says why a failed run failed and warns about an expired upload", async () => {
    search = `import=${BATCH_ID}`;
    serve(() =>
      importView({
        status: "failed",
        report: null,
        fileAvailable: false,
        progress: { mode: "dry_run", phase: "failed", done: 0, total: 0, error: "no_name_column" },
      }),
    );
    renderImports();
    expect(await screen.findByText(t("admin.drugs.imports.error.no_name_column"))).toBeTruthy();
    expect(screen.getByText(t("admin.drugs.imports.fileGone"))).toBeTruthy();
  });

  it("is read-only without drugs.write: no upload, no mapping, no commit", async () => {
    search = `import=${BATCH_ID}`;
    serve(() => importView());
    renderImports(false);
    await screen.findByText(t("admin.drugs.imports.report.title"));
    expect(screen.queryByText(t("admin.drugs.imports.upload.button"))).toBeNull();
    expect(screen.queryByLabelText("Trade Name")).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("admin.drugs.imports.commit.button") }),
    ).toBeNull();
  });

  it("uploads the file with its source as multipart and opens the new batch", async () => {
    serve(() => importView());
    renderImports();
    const file = new File(["[]"], "list.json", { type: "application/json" });
    await userEvent.selectOptions(
      await screen.findByLabelText(t("admin.drugs.imports.source")),
      "sfda",
    );
    await userEvent.upload(screen.getByLabelText(t("admin.drugs.imports.file")), file);
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.drugs.imports.upload.button") }),
    );

    await waitFor(() => {
      expect(callsTo("POST", "/admin/drugs/imports")).toHaveLength(1);
    });
    const body = callsTo("POST", "/admin/drugs/imports")[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("source")).toBe("sfda");
    expect((body as FormData).get("file")).toBeInstanceOf(File);
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining(`import=${BATCH_ID}`),
      expect.anything(),
    );
  });

  it("asks for a file before uploading", async () => {
    serve(() => importView());
    renderImports();
    await userEvent.click(
      await screen.findByRole("button", { name: t("admin.drugs.imports.upload.button") }),
    );
    expect(await screen.findByText(t("admin.drugs.imports.file.required"))).toBeTruthy();
    expect(callsTo("POST", "/admin/drugs/imports")).toHaveLength(0);
  });
});

function drug(overrides: Partial<DrugView> = {}): DrugView {
  return {
    id: DRUG_ID,
    brandEn: "Panadol",
    brandAr: "بنادول",
    form: "tablet",
    strengthText: "500 mg",
    strengthValueMicro: 500_000_000,
    strengthUnit: "mg",
    manufacturer: null,
    country: null,
    status: "active",
    importBatchId: null,
    category: null,
    packText: null,
    unitsCount: null,
    barcode: null,
    priceMinor: null,
    oldPriceMinor: null,
    currency: "EGP",
    brandKey: "panadol",
    source: null,
    priceUpdatedAt: null,
    adminEditedAt: null,
    ingredients: [{ id: BATCH_ID, nameEn: "Paracetamol", nameAr: null, strengthText: "500 mg" }],
    aliases: [],
    createdAt: "2026-10-12T08:00:00.000Z",
    updatedAt: "2026-10-12T08:00:00.000Z",
    ...overrides,
  };
}

function renderBrowser(canWrite = true) {
  return render(
    <ToastProvider>
      <ReauthProvider>
        <DrugsView canWrite={canWrite} />
      </ReauthProvider>
    </ToastProvider>,
  );
}

describe("DrugsView", () => {
  beforeEach(() => {
    fetchMock.mockImplementation((url, init) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      if (path.includes("/admin/drugs?") || path.endsWith("/admin/drugs")) {
        return Promise.resolve(
          json({
            items: [
              {
                ...drug(),
                match: {
                  score: 1,
                  class: "accept",
                  explanation: {
                    nameScore: 1,
                    matchedOn: "brand",
                    strength: "match",
                    form: "unknown",
                  },
                },
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (path.endsWith(`/admin/drugs/${DRUG_ID}`) && method === "PATCH") {
        return Promise.resolve(json(drug({ manufacturer: "Acme" })));
      }
      if (path.endsWith(`/admin/drugs/${DRUG_ID}/aliases`) && method === "POST") {
        return Promise.resolve(json(drug(), 201));
      }
      if (path.endsWith(`/admin/drugs/${DRUG_ID}`)) return Promise.resolve(json(drug()));
      return Promise.resolve(json({}));
    });
  });

  it("lists matches with their score and why", async () => {
    search = "q=panadol";
    renderBrowser();
    expect((await screen.findAllByText("Panadol")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/100%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("admin.drugs.match.accept")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Paracetamol/).length).toBeGreaterThan(0);
  });

  it("sends only the changed fields when saving an edit", async () => {
    search = `drug=${DRUG_ID}`;
    renderBrowser();
    const manufacturer = await screen.findByLabelText(t("admin.drugs.field.manufacturer"));
    await userEvent.type(manufacturer, "Acme");
    await userEvent.click(screen.getByRole("button", { name: t("admin.drugs.edit.save") }));
    await waitFor(() => {
      expect(callsTo("PATCH", `/admin/drugs/${DRUG_ID}`)).toHaveLength(1);
    });
    expect(JSON.parse(String(callsTo("PATCH", `/admin/drugs/${DRUG_ID}`)[0]?.[1]?.body))).toEqual({
      manufacturer: "Acme",
    });
  });

  it("adds an alias and refuses an empty one", async () => {
    search = `drug=${DRUG_ID}`;
    renderBrowser();
    const field = await screen.findByLabelText(t("admin.drugs.aliases.label"));
    await userEvent.click(screen.getByRole("button", { name: t("admin.drugs.aliases.add") }));
    expect(callsTo("POST", `/admin/drugs/${DRUG_ID}/aliases`)).toHaveLength(0);

    await userEvent.type(field, "Panadol tabs");
    await userEvent.click(screen.getByRole("button", { name: t("admin.drugs.aliases.add") }));
    await waitFor(() => {
      expect(callsTo("POST", `/admin/drugs/${DRUG_ID}/aliases`)).toHaveLength(1);
    });
    expect(
      JSON.parse(String(callsTo("POST", `/admin/drugs/${DRUG_ID}/aliases`)[0]?.[1]?.body)),
    ).toEqual({
      alias: "Panadol tabs",
    });
  });

  it("shows no edit, alias or merge controls without drugs.write", async () => {
    search = `drug=${DRUG_ID}`;
    renderBrowser(false);
    await screen.findByText(t("admin.drugs.drawer.details"));
    expect(screen.queryByRole("button", { name: t("admin.drugs.edit.save") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("admin.drugs.merge.button") })).toBeNull();
    expect(screen.queryByLabelText(t("admin.drugs.aliases.label"))).toBeNull();
  });

  it("opens the merge dialog from the drawer", async () => {
    search = `drug=${DRUG_ID}`;
    renderBrowser();
    await userEvent.click(
      await screen.findByRole("button", { name: t("admin.drugs.merge.button") }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: t("admin.drugs.merge.title", { name: "Panadol" }),
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: t("admin.drugs.merge.confirm") })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
