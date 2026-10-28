import { randomUUID } from "node:crypto";

import {
  activeIngredients,
  drugAliases,
  drugImportBatches,
  drugIngredients,
  drugLearned,
  drugUnmatchedNames,
  drugs,
} from "@wasfa/db";
import { drugColumns, drugImportKeys } from "@wasfa/shared/drugs";
import {
  drugSearchResponseSchema,
  drugViewSchema,
  importViewSchema,
  mergeDrugsResponseSchema,
  rollbackResponseSchema,
  type DrugView,
  type ImportView,
} from "@wasfa/shared/schemas/admin-drugs";
import { Queue } from "bullmq";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin, type Person } from "./support/admin-context.js";
import { WEB } from "./support/auth-harness.js";

import type { LightMyRequestResponse } from "fastify";

const ctx = new AdminTestContext();
let boss: Admin;
let drugsQueue: Queue;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  drugsQueue = new Queue("drugs", { connection: ctx.redis });
}, 180_000);

afterAll(async () => {
  await drugsQueue?.close();
  await ctx.stop();
});

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const call = (
  method: Method,
  url: string,
  who: { jar: Person["jar"] },
  body?: Record<string, unknown>,
) => ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function expectError(res: LightMyRequestResponse, status: number, code: string, reason?: string) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({ code, ...(reason ? { details: { reason } } : {}) });
}

interface SeedDrug {
  brandEn: string;
  brandAr?: string;
  form?: string;
  strength?: string;
  ingredients?: string[];
  aliases?: string[];
}

async function seed(drug: SeedDrug): Promise<string> {
  const [row] = await ctx.owner.db
    .insert(drugs)
    .values(
      drugColumns({
        brandEn: drug.brandEn,
        brandAr: drug.brandAr,
        form: drug.form,
        strengthText: drug.strength,
      }),
    )
    .returning({ id: drugs.id });
  if (!row) throw new Error("drug was not stored");
  for (const name of drug.ingredients ?? []) {
    const normalized = name.toLowerCase();
    await ctx.owner.db
      .insert(activeIngredients)
      .values({ nameEn: name, normalized })
      .onConflictDoNothing();
    const [ingredient] = await ctx.owner.db
      .select()
      .from(activeIngredients)
      .where(eq(activeIngredients.normalized, normalized));
    if (!ingredient) throw new Error("ingredient missing");
    await ctx.owner.db
      .insert(drugIngredients)
      .values({ drugId: row.id, ingredientId: ingredient.id });
  }
  for (const alias of drug.aliases ?? []) {
    await ctx.owner.db
      .insert(drugAliases)
      .values({ drugId: row.id, alias, normalized: alias.toLowerCase(), lang: "en" });
  }
  return row.id;
}

/** A unique brand per test so the shared database never lets tests see each other's rows. */
const unique = (prefix: string) => `${prefix}${randomUUID().slice(0, 8).replace(/\d/g, "x")}`;

const view = (res: LightMyRequestResponse): DrugView => {
  expect(res.statusCode, res.body).toBeLessThan(300);
  return drugViewSchema.parse(res.json());
};

describe("access", () => {
  let plain: Person;
  let noSecondFactor: Person;
  let readOnly: Admin;
  let cannotRead: Admin;
  let cannotWrite: Admin;

  beforeAll(async () => {
    plain = await ctx.harness.signedInUser();
    noSecondFactor = await ctx.adminWithoutTwoFactor("super_admin");
    readOnly = await ctx.admin(await ctx.customRole(["drugs.read"]));
    cannotRead = await ctx.admin(await ctx.roleLacking("drugs.read"));
    cannotWrite = await ctx.admin(await ctx.roleLacking("drugs.write"));
  }, 120_000);

  const routes: {
    name: string;
    method: Method;
    url: string;
    body?: Record<string, unknown>;
    write: boolean;
  }[] = [
    { name: "search", method: "GET", url: "/admin/drugs?q=abc", write: false },
    { name: "get", method: "GET", url: `/admin/drugs/${MISSING_ID}`, write: false },
    { name: "list imports", method: "GET", url: "/admin/drugs/imports", write: false },
    { name: "get import", method: "GET", url: `/admin/drugs/imports/${MISSING_ID}`, write: false },
    {
      name: "update",
      method: "PATCH",
      url: `/admin/drugs/${MISSING_ID}`,
      body: { status: "withdrawn" },
      write: true,
    },
    {
      name: "alias",
      method: "POST",
      url: `/admin/drugs/${MISSING_ID}/aliases`,
      body: { alias: "x" },
      write: true,
    },
    {
      name: "merge",
      method: "POST",
      url: "/admin/drugs/merge",
      body: { keepId: MISSING_ID, mergeId: randomUUID() },
      write: true,
    },
    {
      name: "dry run",
      method: "POST",
      url: `/admin/drugs/imports/${MISSING_ID}/dry-run`,
      body: {},
      write: true,
    },
    {
      name: "commit",
      method: "POST",
      url: `/admin/drugs/imports/${MISSING_ID}/commit`,
      body: {},
      write: true,
    },
    {
      name: "rollback",
      method: "POST",
      url: `/admin/drugs/imports/${MISSING_ID}/rollback`,
      body: {},
      write: true,
    },
  ];

  for (const route of routes) {
    describe(route.name, () => {
      const send = (who?: { jar: Person["jar"] }) =>
        ctx.harness.call(route.method, route.url, {
          ...(who ? { jar: who.jar } : {}),
          ...(route.body ? { body: route.body } : {}),
        });

      it("refuses everyone without the permission", async () => {
        expectError(await send(), 401, "AUTH_REQUIRED");
        expectError(await send(plain), 403, "FORBIDDEN");
        expectError(await send(route.write ? cannotWrite : cannotRead), 403, "FORBIDDEN");
        expectError(await send(noSecondFactor), 403, "FORBIDDEN", "two_factor_required");
      });

      it(route.write ? "needs drugs.write" : "is open to drugs.read", async () => {
        const res = await send(readOnly);
        if (route.write) expectError(res, 403, "FORBIDDEN");
        else expect(res.statusCode).not.toBe(403);
      });
    });
  }

  it("asks for a fresh login to merge, commit and roll back, not to edit", async () => {
    const admin = await ctx.admin("super_admin");
    await ctx.makeSessionStale(admin.userId);
    for (const name of ["merge", "commit", "rollback"]) {
      const route = routes.find((r) => r.name === name);
      if (!route) throw new Error("route missing");
      const res = await ctx.harness.call(route.method, route.url, {
        jar: admin.jar,
        body: route.body ?? {},
      });
      expect(res.statusCode, name).toBe(401);
      expect(res.json()).toMatchObject({ details: { reason: "reauth" } });
    }
    const edit = await call("PATCH", `/admin/drugs/${MISSING_ID}`, admin, { status: "active" });
    expectError(edit, 404, "NOT_FOUND");
  });
});

describe("browse, edit and alias", () => {
  it("searches with the matcher and explains each hit", async () => {
    const brand = unique("Zorvex");
    const id = await seed({
      brandEn: brand,
      brandAr: "زورفكس",
      form: "tablet",
      strength: "250 mg",
    });

    const res = await call("GET", `/admin/drugs?q=${encodeURIComponent(`${brand} 250mg`)}`, boss);
    expect(res.statusCode, res.body).toBe(200);
    const body = drugSearchResponseSchema.parse(res.json());
    const top = body.items[0];
    expect(top?.id).toBe(id);
    expect(top?.match).toMatchObject({
      class: "accept",
      explanation: { matchedOn: "brand", strength: "match" },
    });

    const arabic = drugSearchResponseSchema.parse(
      (await call("GET", `/admin/drugs?q=${encodeURIComponent("زورفكس")}`, boss)).json(),
    );
    expect(arabic.items[0]?.id).toBe(id);

    const withForm = drugSearchResponseSchema.parse(
      (
        await call(
          "GET",
          `/admin/drugs?q=${brand}&strength=${encodeURIComponent("500 mg")}&form=tablet`,
          boss,
        )
      ).json(),
    );
    expect(withForm.items[0]?.match?.explanation).toMatchObject({
      strength: "conflict",
      form: "match",
    });
  });

  it("lists recent drugs without a query and rejects a bad limit", async () => {
    await seed({ brandEn: unique("Recentol") });
    const res = await call("GET", "/admin/drugs", boss);
    const body = drugSearchResponseSchema.parse(res.json());
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.match === null)).toBe(true);
    expectError(await call("GET", "/admin/drugs?limit=500", boss), 400, "VALIDATION_FAILED");
  });

  it("edits a drug, re-derives the searchable columns and audits before and after", async () => {
    const brand = unique("Editol");
    const id = await seed({ brandEn: brand, form: "tablet", strength: "100 mg" });

    const renamed = unique("Renamex");
    const edited = view(
      await call("PATCH", `/admin/drugs/${id}`, boss, {
        brandEn: `${renamed} 200mg Caps`,
        strengthText: "200 mg",
        manufacturer: "Acme",
        country: "eg",
        form: "Caps",
      }),
    );
    expect(edited).toMatchObject({
      brandEn: `${renamed} 200mg Caps`,
      form: "capsule",
      strengthText: "200 mg",
      strengthValueMicro: 200_000_000,
      strengthUnit: "mg",
      manufacturer: "Acme",
      country: "EG",
    });
    const [row] = await ctx.owner.db.select().from(drugs).where(eq(drugs.id, id));
    expect(row?.normalizedEn).toBe(renamed.toLowerCase());

    // The edited drug is now found under its new name.
    const found = drugSearchResponseSchema.parse(
      (await call("GET", `/admin/drugs?q=${renamed}`, boss)).json(),
    );
    expect(found.items[0]?.id).toBe(id);

    const [audit] = await ctx.auditRowsFor("drug.update", id);
    expect(audit?.actorId).toBe(boss.userId);
    expect(audit?.before).toMatchObject({ form: "tablet", strengthText: "100 mg" });
    expect(audit?.after).toMatchObject({ form: "capsule", strengthText: "200 mg", country: "EG" });

    // Plain fields leave the derived columns alone; clearing works.
    const withdrawn = view(
      await call("PATCH", `/admin/drugs/${id}`, boss, { status: "withdrawn", manufacturer: null }),
    );
    expect(withdrawn).toMatchObject({
      status: "withdrawn",
      manufacturer: null,
      strengthValueMicro: 200_000_000,
    });
  });

  it("validates edits and answers 404 for a missing drug", async () => {
    const id = await seed({ brandEn: unique("Validol") });
    expectError(await call("PATCH", `/admin/drugs/${id}`, boss, {}), 400, "VALIDATION_FAILED");
    expectError(
      await call("PATCH", `/admin/drugs/${id}`, boss, { country: "Egypt" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("PATCH", `/admin/drugs/${id}`, boss, { brandEn: "" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("PATCH", `/admin/drugs/${id}`, boss, { brandEn: "---" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("PATCH", `/admin/drugs/${MISSING_ID}`, boss, { status: "active" }),
      404,
      "NOT_FOUND",
    );
    expectError(await call("GET", `/admin/drugs/${MISSING_ID}`, boss), 404, "NOT_FOUND");
    expectError(await call("GET", "/admin/drugs/not-a-uuid", boss), 400, "VALIDATION_FAILED");
  });

  it("adds an alias that makes the drug findable, once", async () => {
    const id = await seed({ brandEn: unique("Aliasol") });
    const nickname = unique("Nickname");
    const updated = view(
      await call("POST", `/admin/drugs/${id}/aliases`, boss, { alias: nickname }),
    );
    expect(updated.aliases).toEqual([
      expect.objectContaining({ alias: nickname, lang: "en", source: "admin" }),
    ]);

    const found = drugSearchResponseSchema.parse(
      (await call("GET", `/admin/drugs?q=${nickname}`, boss)).json(),
    );
    expect(found.items[0]).toMatchObject({ id, match: { explanation: { matchedOn: "alias" } } });

    expectError(
      await call("POST", `/admin/drugs/${id}/aliases`, boss, { alias: nickname.toUpperCase() }),
      409,
      "CONFLICT",
      "alias_exists",
    );
    expectError(
      await call("POST", `/admin/drugs/${id}/aliases`, boss, { alias: updated.brandEn }),
      409,
      "CONFLICT",
      "alias_exists",
    );
    expectError(
      await call("POST", `/admin/drugs/${id}/aliases`, boss, { alias: "!!!" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("POST", `/admin/drugs/${MISSING_ID}/aliases`, boss, { alias: "x" }),
      404,
      "NOT_FOUND",
    );

    const arabic = view(
      await call("POST", `/admin/drugs/${id}/aliases`, boss, { alias: "اسم بديل" }),
    );
    expect(arabic.aliases.map((a) => a.lang).sort()).toEqual(["ar", "en"]);

    const audits = await ctx.auditRowsFor("drug.alias_add", id);
    expect(audits).toHaveLength(2);
    expect(audits.map((row) => row.after)).toContainEqual(
      expect.objectContaining({ alias: nickname, lang: "en" }),
    );
  });
});

describe("merge", () => {
  it("moves aliases and ingredients, keeps the merged names as aliases and deletes the duplicate", async () => {
    const brand = unique("Mergex");
    const keep = await seed({
      brandEn: brand,
      ingredients: ["Mergecillin"],
      aliases: ["shared alias"],
    });
    const duplicate = await seed({
      brandEn: `${brand}e`,
      brandAr: "ميرجكس",
      ingredients: ["Mergecillin", "Extradrol"],
      aliases: ["shared alias", "only on duplicate"],
    });

    const res = await call("POST", "/admin/drugs/merge", boss, {
      keepId: keep,
      mergeId: duplicate,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = mergeDrugsResponseSchema.parse(res.json());
    // Moved: "only on duplicate" plus the two names of the duplicate; "shared alias" was already there.
    expect(body.movedAliases).toBe(3);
    expect(body.movedIngredients).toBe(1);
    expect(body.kept.id).toBe(keep);
    expect(body.kept.ingredients.map((i) => i.nameEn).sort()).toEqual(["Extradrol", "Mergecillin"]);
    expect(body.kept.aliases.map((a) => a.alias).sort()).toEqual(
      [`${brand}e`, "only on duplicate", "shared alias", "ميرجكس"].sort(),
    );

    const [gone] = await ctx.owner.db.select().from(drugs).where(eq(drugs.id, duplicate));
    expect(gone).toBeUndefined();
    const [links] = await ctx.owner.db
      .select({ n: count() })
      .from(drugIngredients)
      .where(eq(drugIngredients.drugId, duplicate));
    expect(links?.n).toBe(0);

    const [audit] = await ctx.auditRowsFor("drug.merge", keep);
    expect(audit?.before).toMatchObject({ brandEn: `${brand}e` });
    expect(audit?.after).toMatchObject({ brandEn: brand, movedAliases: 3, movedIngredients: 1 });

    // The merged drug's old name still finds the survivor.
    const found = drugSearchResponseSchema.parse(
      (await call("GET", `/admin/drugs?q=${brand}e`, boss)).json(),
    );
    expect(found.items.map((i) => i.id)).toContain(keep);
  });

  it("refuses the same drug twice, a missing drug, and a second merge of the same one", async () => {
    const a = await seed({ brandEn: unique("Twinol") });
    const b = await seed({ brandEn: unique("Twinel") });
    expectError(
      await call("POST", "/admin/drugs/merge", boss, { keepId: a, mergeId: a }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("POST", "/admin/drugs/merge", boss, { keepId: a, mergeId: MISSING_ID }),
      404,
      "NOT_FOUND",
    );
    expect(
      (await call("POST", "/admin/drugs/merge", boss, { keepId: a, mergeId: b })).statusCode,
    ).toBe(200);
    expectError(
      await call("POST", "/admin/drugs/merge", boss, { keepId: a, mergeId: b }),
      404,
      "NOT_FOUND",
    );
  });
});

// --- Catalog management and review queues (docs/MEDICATIONS.md section 7) ---

describe("catalog management", () => {
  it("creates a manual entry with ingredients, price and brand family", async () => {
    const brand = unique("Createx");
    const created = view(
      await call("POST", "/admin/drugs", boss, {
        brandEn: `${brand} 500mg 20 caps`,
        category: "Antibiotics",
        priceMinor: 4250,
        barcode: "6221000012345",
        ingredients: [{ name: "Createxillin", strength: "500 mg" }],
      }),
    );
    expect(created).toMatchObject({
      source: "manual",
      brandKey: brand.toLowerCase(),
      category: "Antibiotics",
      priceMinor: 4250,
      currency: "EGP",
      ingredients: [{ nameEn: "Createxillin", strengthText: "500 mg" }],
    });
    expect(created.adminEditedAt).not.toBeNull();
    expect(created.priceUpdatedAt).not.toBeNull();
    const [audit] = await ctx.auditRowsFor("drug.create", created.id);
    expect(audit?.after).toMatchObject({ category: "Antibiotics" });
    expectError(
      await call("POST", "/admin/drugs", boss, { brandEn: "" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("POST", "/admin/drugs", boss, { brandEn: "Zzz", priceMinor: 1.5 }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("replaces ingredients and re-derives the brand key on edit", async () => {
    const id = await seed({ brandEn: unique("Editfam"), ingredients: ["Oldingredient"] });
    const renamed = unique("Newfam");
    const edited = view(
      await call("PATCH", `/admin/drugs/${id}`, boss, {
        brandEn: `${renamed} 10mg`,
        priceMinor: 900,
        ingredients: [{ name: "Freshingredient" }],
      }),
    );
    expect(edited.brandKey).toBe(renamed.toLowerCase());
    expect(edited.priceMinor).toBe(900);
    expect(edited.ingredients.map((i) => i.nameEn)).toEqual(["Freshingredient"]);
  });

  it("withdraws, restores and deletes", async () => {
    const id = await seed({ brandEn: unique("Statusol") });
    expect(
      view(await call("POST", `/admin/drugs/${id}/status`, boss, { status: "withdrawn" })).status,
    ).toBe("withdrawn");
    expect(
      view(await call("POST", `/admin/drugs/${id}/status`, boss, { status: "active" })).status,
    ).toBe("active");
    expectError(
      await call("POST", `/admin/drugs/${id}/status`, boss, { status: "gone" }),
      400,
      "VALIDATION_FAILED",
    );
    const removed = await call("DELETE", `/admin/drugs/${id}`, boss);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toEqual({ deleted: true });
    expectError(await call("GET", `/admin/drugs/${id}`, boss), 404, "NOT_FOUND");
    expectError(await call("DELETE", `/admin/drugs/${id}`, boss), 404, "NOT_FOUND");
    expect(await ctx.auditRowsFor("drug.delete", id)).toHaveLength(1);
  });

  it("lists by brand with filters and pages", async () => {
    const category = unique("Cat");
    for (const suffix of ["a", "b", "c"]) {
      await call("POST", "/admin/drugs", boss, { brandEn: unique(`List${suffix}`), category });
    }
    const first = drugSearchResponseSchema.parse(
      (await call("GET", `/admin/drugs?category=${category}&limit=2&missing=price`, boss)).json(),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = drugSearchResponseSchema.parse(
      (
        await call(
          "GET",
          `/admin/drugs?category=${category}&limit=2&missing=price&cursor=${first.nextCursor ?? ""}`,
          boss,
        )
      ).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const categories = (await call("GET", "/admin/drugs/categories", boss)).json() as {
      items: { category: string; count: number }[];
    };
    expect(categories.items).toContainEqual({ category, count: 3 });
  });
});

describe("review queues", () => {
  const reading = () => unique("reading").toLowerCase();

  it("maps an unmatched reading to a drug as an admin alias", async () => {
    const id = await seed({ brandEn: unique("Mapped") });
    const normalized = reading();
    await ctx.owner.db
      .insert(drugUnmatchedNames)
      .values({ normalized, sample: normalized.toUpperCase(), hits: 7 });

    const list = (await call("GET", "/admin/drugs/unmatched?status=open", boss)).json() as {
      items: { normalized: string; hits: number }[];
    };
    expect(list.items.find((item) => item.normalized === normalized)?.hits).toBe(7);

    const mapped = await call(
      "POST",
      `/admin/drugs/unmatched/${encodeURIComponent(normalized)}/map`,
      boss,
      { drugId: id },
    );
    expect(mapped.statusCode, mapped.body).toBe(200);
    const [alias] = await ctx.owner.db.select().from(drugAliases).where(eq(drugAliases.drugId, id));
    expect(alias).toMatchObject({ normalized, source: "admin" });
    const [entry] = await ctx.owner.db
      .select()
      .from(drugUnmatchedNames)
      .where(eq(drugUnmatchedNames.normalized, normalized));
    expect(entry).toMatchObject({ status: "mapped", mappedDrugId: id });
    expect(await ctx.auditRowsFor("drug.unmatched_map", id)).toHaveLength(1);

    expectError(
      await call("POST", `/admin/drugs/unmatched/${normalized}/map`, boss, { drugId: MISSING_ID }),
      404,
      "NOT_FOUND",
    );
  });

  it("ignores an unmatched reading", async () => {
    const normalized = reading();
    await ctx.owner.db.insert(drugUnmatchedNames).values({ normalized, sample: normalized });
    expect(
      (await call("POST", `/admin/drugs/unmatched/${normalized}/ignore`, boss)).statusCode,
    ).toBe(200);
    const [entry] = await ctx.owner.db
      .select()
      .from(drugUnmatchedNames)
      .where(eq(drugUnmatchedNames.normalized, normalized));
    expect(entry?.status).toBe("ignored");
    expectError(
      await call("POST", `/admin/drugs/unmatched/${reading()}/ignore`, boss),
      404,
      "NOT_FOUND",
    );
  });

  it("approves and rejects learned aliases", async () => {
    const id = await seed({ brandEn: unique("Learned") });
    const approved = reading();
    const rejected = reading();
    await ctx.owner.db.insert(drugLearned).values([
      { normalized: approved, drugId: id, votes: 2 },
      { normalized: rejected, drugId: id, votes: 1 },
    ]);
    const list = (await call("GET", "/admin/drugs/learned?status=pending", boss)).json() as {
      items: { normalized: string; votes: number }[];
    };
    expect(list.items.map((item) => item.normalized)).toEqual(
      expect.arrayContaining([approved, rejected]),
    );

    expect(
      (
        await call("POST", "/admin/drugs/learned/approve", boss, {
          normalized: approved,
          drugId: id,
        })
      ).statusCode,
    ).toBe(200);
    const [alias] = await ctx.owner.db
      .select()
      .from(drugAliases)
      .where(eq(drugAliases.normalized, approved));
    expect(alias).toMatchObject({ drugId: id, source: "learned" });

    expect(
      (
        await call("POST", "/admin/drugs/learned/reject", boss, {
          normalized: rejected,
          drugId: id,
        })
      ).statusCode,
    ).toBe(200);
    const [pair] = await ctx.owner.db
      .select()
      .from(drugLearned)
      .where(eq(drugLearned.normalized, rejected));
    expect(pair?.status).toBe("rejected");
    expectError(
      await call("POST", "/admin/drugs/learned/reject", boss, {
        normalized: reading(),
        drugId: id,
      }),
      404,
      "NOT_FOUND",
    );
  });
});

// --- Import wizard ---

const boundary = () => `----wasfa${randomUUID()}`;

function multipart(
  fields: Record<string, string>,
  file?: { name: string; bytes: Buffer },
): { payload: Buffer; contentType: string } {
  const id = boundary();
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${id}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${id}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      file.bytes,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${id}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${id}` };
}

function upload(
  who: { jar: Person["jar"] },
  fields: Record<string, string>,
  file?: { name: string; bytes: Buffer },
) {
  const { payload, contentType } = multipart(fields, file);
  return ctx.app.inject({
    method: "POST",
    url: "/admin/drugs/imports",
    remoteAddress: `10.9.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`,
    headers: {
      origin: WEB,
      "content-type": contentType,
      cookie: [...who.jar].map(([name, value]) => `${name}=${value}`).join("; "),
    },
    payload,
  });
}

const jsonFile = (rows: unknown) => ({
  name: "drugs.json",
  bytes: Buffer.from(JSON.stringify(rows)),
});

const importView = (res: LightMyRequestResponse): ImportView => {
  expect(res.statusCode, res.body).toBeLessThan(300);
  return importViewSchema.parse(res.json());
};

async function jobsOf(batchId: string) {
  const jobs = await drugsQueue.getJobs(["waiting", "active", "delayed", "completed", "failed"]);
  return jobs.filter((job) => (job.data as { batchId?: string }).batchId === batchId);
}

describe("import wizard", () => {
  it("stores the upload in Redis, queues a dry run and audits it", async () => {
    const res = await upload(boss, { source: "sfda" }, jsonFile([{ "Trade Name": "A" }]));
    expect(res.statusCode, res.body).toBe(201);
    const created = importView(res);
    expect(created).toMatchObject({
      fileName: "drugs.json",
      source: "sfda",
      status: "draft",
      mapping: {},
      fileAvailable: true,
      progress: { mode: "dry_run", phase: "queued" },
    });

    const keys = drugImportKeys(created.id);
    const stored = await ctx.redis.getBuffer(keys.file);
    expect(stored?.toString("utf8")).toBe(JSON.stringify([{ "Trade Name": "A" }]));
    expect(await ctx.redis.ttl(keys.file)).toBeGreaterThan(0);
    const [job] = await jobsOf(created.id);
    expect(job?.name).toBe("drugs.import");
    expect(job?.data).toMatchObject({ batchId: created.id, mode: "dry_run", actorId: boss.userId });
    expect(job?.opts.attempts).toBe(1);

    const [audit] = await ctx.auditRowsFor("drug_import.create", created.id);
    expect(audit?.after).toMatchObject({ fileName: "drugs.json", source: "sfda" });

    // The wizard can read it back, and see it in the history.
    expect(importView(await call("GET", `/admin/drugs/imports/${created.id}`, boss)).id).toBe(
      created.id,
    );
    const list = (await call("GET", "/admin/drugs/imports", boss)).json() as {
      items: { id: string }[];
    };
    expect(list.items.map((i) => i.id)).toContain(created.id);
  });

  it("keeps the admin's mapping and rejects a broken or contradictory one", async () => {
    const mapping = { Name: "brandEn", Maker: "manufacturer" };
    const ok = await upload(
      boss,
      { source: "other", mapping: JSON.stringify(mapping) },
      jsonFile([{ Name: "A" }]),
    );
    expect(importView(ok).mapping).toEqual(mapping);

    for (const bad of [
      "not json",
      JSON.stringify({ Name: "nonsense" }),
      JSON.stringify({ A: "brandEn", B: "brandEn" }),
    ]) {
      expectError(
        await upload(boss, { source: "other", mapping: bad }, jsonFile([{}])),
        400,
        "VALIDATION_FAILED",
      );
    }
  });

  it("refuses a missing, empty, unsupported, oversized or second file", async () => {
    expectError(await upload(boss, { source: "eda" }), 400, "VALIDATION_FAILED", "file_required");
    expectError(
      await upload(boss, { source: "eda" }, { name: "empty.json", bytes: Buffer.alloc(0) }),
      400,
      "VALIDATION_FAILED",
      "file_required",
    );
    expectError(
      await upload(
        boss,
        { source: "eda" },
        { name: "x.png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
      ),
      400,
      "VALIDATION_FAILED",
      "unsupported_file",
    );
    expectError(await upload(boss, { source: "nope" }, jsonFile([])), 400, "VALIDATION_FAILED");
    expectError(await upload(boss, {}, jsonFile([])), 400, "VALIDATION_FAILED");

    const tooBig = Buffer.alloc(21 * 1024 * 1024, 0x20);
    tooBig[0] = 0x5b; // "[": looks like JSON, but is over 20 MB
    expectError(
      await upload(boss, { source: "eda" }, { name: "big.json", bytes: tooBig }),
      400,
      "VALIDATION_FAILED",
      "file_too_large",
    );
    // Nothing is left behind by refused uploads: only rows from the accepted ones exist.
    const [batches] = await ctx.owner.db
      .select({ n: count() })
      .from(drugImportBatches)
      .where(eq(drugImportBatches.fileName, "big.json"));
    expect(batches?.n).toBe(0);
  }, 60_000);

  it("accepts a workbook by its zip signature and strips paths from the file name", async () => {
    const zipLike = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("rest")]);
    const res = await upload(
      boss,
      { source: "eda" },
      { name: "C:\\fakepath\\..\\list 2026.xlsx", bytes: zipLike },
    );
    expect(importView(res).fileName).toBe("list 2026.xlsx");
  });

  it("does not accept a plain JSON body on the upload route", async () => {
    expectError(
      await call("POST", "/admin/drugs/imports", boss, { source: "eda" }),
      400,
      "VALIDATION_FAILED",
      "not_multipart",
    );
  });

  describe("dry run, commit and rollback", () => {
    let batchId: string;

    beforeAll(async () => {
      const created = importView(await upload(boss, { source: "eda" }, jsonFile([{ n: "x" }])));
      batchId = created.id;
      // The worker would now run the dry run; the api only needs to see its outcome.
      await ctx.redis.del(drugImportKeys(batchId).busy);
    });

    it("refuses a commit before a dry run has passed", async () => {
      expectError(
        await call("POST", `/admin/drugs/imports/${batchId}/commit`, boss, {}),
        409,
        "CONFLICT",
        "dry_run_required",
      );
    });

    it("queues a dry run with a corrected mapping, one at a time", async () => {
      const mapping = { n: "brandEn" };
      const res = await call("POST", `/admin/drugs/imports/${batchId}/dry-run`, boss, { mapping });
      expect(importView(res).mapping).toEqual(mapping);
      expect(importView(res).progress).toMatchObject({ mode: "dry_run", phase: "queued" });
      // The first one is still queued or running: the batch is busy.
      expectError(
        await call("POST", `/admin/drugs/imports/${batchId}/dry-run`, boss, {}),
        409,
        "CONFLICT",
        "busy",
      );
      expectError(
        await call("POST", `/admin/drugs/imports/${batchId}/dry-run`, boss, {
          mapping: { n: "nonsense" },
        }),
        400,
        "VALIDATION_FAILED",
      );
      await ctx.redis.del(drugImportKeys(batchId).busy);
    });

    it("commits a dry-run batch: queued with the actor, audited, and rolled back later", async () => {
      await ctx.owner.db
        .update(drugImportBatches)
        .set({ status: "dry_run", rowsTotal: 3 })
        .where(eq(drugImportBatches.id, batchId));

      const res = await call("POST", `/admin/drugs/imports/${batchId}/commit`, boss, {});
      expect(importView(res).progress).toMatchObject({ mode: "commit", phase: "queued" });
      const commitJob = (await jobsOf(batchId)).find(
        (job) => (job.data as { mode: string }).mode === "commit",
      );
      expect(commitJob?.data).toMatchObject({ batchId, actorId: boss.userId });
      const [audit] = await ctx.auditRowsFor("drug_import.commit", batchId);
      expect(audit?.after).toMatchObject({ fileName: "drugs.json", rowsTotal: 3 });
      expectError(
        await call("POST", `/admin/drugs/imports/${batchId}/commit`, boss, {}),
        409,
        "CONFLICT",
        "busy",
      );

      // Rollback is refused until the batch is committed.
      await ctx.redis.del(drugImportKeys(batchId).busy);
      expectError(
        await call("POST", `/admin/drugs/imports/${batchId}/rollback`, boss, {}),
        409,
        "CONFLICT",
        "not_committed",
      );
    });

    it("rolls a committed batch back: inserted rows go, updated ones are un-tagged, once", async () => {
      const committedAt = new Date(Date.now() - 60_000);
      await ctx.owner.db
        .update(drugImportBatches)
        .set({ status: "committed", committedAt, rowsInserted: 2, rowsUpdated: 1 })
        .where(eq(drugImportBatches.id, batchId));
      const inserted = await seed({
        brandEn: unique("Rollin"),
        ingredients: ["Rollcillin"],
        aliases: ["roll alias"],
      });
      const insertedToo = await seed({ brandEn: unique("Rollon") });
      const updated = await seed({ brandEn: unique("Rollup") });
      await ctx.owner.db
        .update(drugs)
        .set({ importBatchId: batchId })
        .where(eq(drugs.id, inserted));
      await ctx.owner.db
        .update(drugs)
        .set({ importBatchId: batchId })
        .where(eq(drugs.id, insertedToo));
      // "Updated" means it existed before the commit started.
      await ctx.owner.db
        .update(drugs)
        .set({ importBatchId: batchId, createdAt: new Date(committedAt.getTime() - 86_400_000) })
        .where(eq(drugs.id, updated));
      await ctx.owner.db
        .update(activeIngredients)
        .set({ importBatchId: batchId })
        .where(eq(activeIngredients.normalized, "rollcillin"));
      await ctx.owner.db
        .update(drugAliases)
        .set({ importBatchId: batchId })
        .where(eq(drugAliases.drugId, inserted));

      const res = await call("POST", `/admin/drugs/imports/${batchId}/rollback`, boss, {});
      expect(res.statusCode, res.body).toBe(200);
      expect(rollbackResponseSchema.parse(res.json())).toEqual({
        deletedDrugs: 2,
        untaggedDrugs: 1,
        deletedIngredients: 1,
        deletedAliases: 1,
      });
      const left = await ctx.owner.db.select().from(drugs).where(eq(drugs.importBatchId, batchId));
      expect(left).toHaveLength(0);
      const [survivor] = await ctx.owner.db.select().from(drugs).where(eq(drugs.id, updated));
      expect(survivor?.importBatchId).toBeNull();
      const [removed] = await ctx.owner.db.select().from(drugs).where(eq(drugs.id, inserted));
      expect(removed).toBeUndefined();

      const view = importView(await call("GET", `/admin/drugs/imports/${batchId}`, boss));
      expect(view.status).toBe("rolled_back");
      expect(view.rolledBackAt).not.toBeNull();
      const [audit] = await ctx.auditRowsFor("drug_import.rollback", batchId);
      expect(audit?.after).toMatchObject({ deletedDrugs: 2, untaggedDrugs: 1 });

      expectError(
        await call("POST", `/admin/drugs/imports/${batchId}/rollback`, boss, {}),
        409,
        "CONFLICT",
        "not_committed",
      );
      expectError(
        await call("POST", `/admin/drugs/imports/${batchId}/dry-run`, boss, {}),
        409,
        "CONFLICT",
        "already_rolled_back",
      );
      expectError(
        await call("POST", `/admin/drugs/imports/${batchId}/commit`, boss, {}),
        409,
        "CONFLICT",
        "already_rolled_back",
      );
    });

    it("reports an expired upload and a missing batch", async () => {
      const created = importView(await upload(boss, { source: "eda" }, jsonFile([{ n: "x" }])));
      await ctx.redis.del(drugImportKeys(created.id).busy, drugImportKeys(created.id).file);
      expect(
        importView(await call("GET", `/admin/drugs/imports/${created.id}`, boss)).fileAvailable,
      ).toBe(false);
      expectError(
        await call("POST", `/admin/drugs/imports/${created.id}/dry-run`, boss, {}),
        409,
        "CONFLICT",
        "file_expired",
      );
      expectError(await call("GET", `/admin/drugs/imports/${MISSING_ID}`, boss), 404, "NOT_FOUND");
    });

    it("hands the report the worker wrote to the screen, and ignores a corrupt one", async () => {
      const created = importView(await upload(boss, { source: "eda" }, jsonFile([{ n: "x" }])));
      const keys = drugImportKeys(created.id);
      const report = {
        mode: "dry_run",
        generatedAt: new Date().toISOString(),
        headers: ["n"],
        mapping: { n: "brandEn" },
        counts: { total: 1, new: 1, updated: 0, duplicate: 0, invalid: 0 },
        reasons: {},
        preview: [],
        samples: { new: [], updated: [], duplicate: [], invalid: [] },
      };
      await ctx.redis.set(keys.report, JSON.stringify(report));
      await ctx.redis.set(
        keys.progress,
        JSON.stringify({ mode: "dry_run", phase: "done", done: 1, total: 1, error: null }),
      );
      const done = importView(await call("GET", `/admin/drugs/imports/${created.id}`, boss));
      expect(done.report?.counts.new).toBe(1);
      expect(done.progress?.phase).toBe("done");

      await ctx.redis.set(keys.report, "{broken");
      expect(
        importView(await call("GET", `/admin/drugs/imports/${created.id}`, boss)).report,
      ).toBeNull();
    });
  });
});
