// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ar, t } from "@wasfa/shared/i18n";
import {
  SETTING_KEYS,
  SETTINGS_REGISTRY,
  settingDefault,
  type SettingKey,
} from "@wasfa/shared/settings";
import { describe, expect, it, vi } from "vitest";

import { SettingForm } from "../src/components/admin/setting-form";
import { ApiRequestError } from "../src/lib/api-error";
import { fromDraft, settingFields, toDraft, type SettingField } from "../src/lib/setting-fields";
import {
  GENERAL_SETTINGS_GROUPS,
  HIDDEN_SETTING_FIELDS,
  SETTING_LAYOUTS,
  SETTING_UNITS,
  UNIT_SCALE,
} from "../src/lib/setting-meta";

/**
 * `skills` is a per-plan map edited on /admin/ai/skills, and `waAgent` (lists, a secret next to it)
 * on /admin/whatsapp/agent: neither is a generated form.
 */
const FORM_KEYS = SETTING_KEYS.filter((key) => key !== "skills" && key !== "waAgent");

function renderForm(key: SettingKey, onSave = vi.fn<(value: unknown) => Promise<void>>()) {
  onSave.mockResolvedValue(undefined);
  render(<SettingForm settingKey={key} value={settingDefault(key)} canWrite onSave={onSave} />);
  return onSave;
}

describe("settingFields", () => {
  it("walks nested objects and enums (auth.providers)", () => {
    const fields = settingFields(SETTINGS_REGISTRY.auth.schema);
    const providers = fields.find((field) => field.name === "providers");
    expect(providers?.kind).toBe("group");
    if (providers?.kind !== "group") return;
    expect(providers.fields.map((field) => field.path)).toEqual([
      "providers.google",
      "providers.facebook",
    ]);
    expect(providers.fields[0]).toMatchObject({
      kind: "enum",
      options: ["enabled", "coming_soon", "disabled"],
    });
  });

  it("keeps the currency refinement's object shape and reads arrays as lists", () => {
    const fields = settingFields(SETTINGS_REGISTRY.currency.schema);
    expect(fields.map((field) => [field.name, field.kind])).toEqual([
      ["default", "text"],
      ["enabled", "list"],
    ]);
  });

  it("round-trips every default through the draft to a value the schema accepts", () => {
    for (const key of FORM_KEYS) {
      const schema = SETTINGS_REGISTRY[key].schema;
      const fields = settingFields(schema);
      const value = fromDraft(fields, toDraft(fields, settingDefault(key)));
      const parsed = schema.safeParse(value);
      expect(parsed.success, key).toBe(true);
      expect(parsed.data, key).toEqual(settingDefault(key));
    }
  });
});

describe("SettingForm", () => {
  it.each(FORM_KEYS)("renders every field of %s and saves its defaults", async (key) => {
    const onSave = renderForm(key);
    const form = screen.getByRole("form", { name: t(`admin.settings.${key}.title`) });
    // One control per leaf of the registry schema.
    const leaves = (function count(fields: ReturnType<typeof settingFields>): number {
      return fields.reduce(
        (total, field) => total + (field.kind === "group" ? count(field.fields) : 1),
        0,
      );
    })(
      settingFields(SETTINGS_REGISTRY[key].schema).filter(
        (field) => !HIDDEN_SETTING_FIELDS.has(`${key}.${field.path}`),
      ),
    );
    expect(form.querySelectorAll("input, select, textarea")).toHaveLength(leaves);

    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(SETTINGS_REGISTRY[key].schema.safeParse(onSave.mock.calls[0]?.[0]).success).toBe(true);
    expect(onSave.mock.calls[0]?.[0]).toEqual(settingDefault(key));
  });

  it("edits the homepage figures and app links, with the measured-only helper text", async () => {
    const onSave = renderForm("landing");
    expect(
      screen.getByText(t("admin.settings.help.landing.proof.avgAnalysisSeconds")).textContent,
    ).toContain("اعرض الرقم فقط عندما يكون مقيسًا");
    await userEvent.type(
      screen.getByLabelText(t("admin.settings.field.landing.proof.avgAnalysisSeconds")),
      "12.5",
    );
    await userEvent.type(
      screen.getByLabelText(t("admin.settings.field.landing.apps.androidUrl")),
      "https://play.google.com/store/apps/details?id=online.wasfa",
    );
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: t("admin.settings.field.landing.apps.waitlistEnabled"),
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      proof: { avgAnalysisSeconds: 12.5, accuracyPercent: null },
      apps: {
        androidUrl: "https://play.google.com/store/apps/details?id=online.wasfa",
        iosUrl: null,
        waitlistEnabled: true,
      },
    });
  });

  it("shows the currency rule when the default is not enabled, and does not save", async () => {
    const onSave = renderForm("currency");
    const enabled = screen.getByLabelText(t("admin.settings.field.currency.enabled"));
    await userEvent.clear(enabled);
    await userEvent.type(enabled, "SAR");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("admin.settings.error.defaultNotEnabled"))).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("turns a list textarea into an array and trims empty lines", async () => {
    const onSave = renderForm("auth");
    const domains = screen.getByLabelText(t("admin.settings.field.auth.blockedEmailDomains"));
    await userEvent.type(domains, "Spam.example.com{Enter}{Enter} junk.example.org ");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    // The schema lowercases and trims each domain.
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      blockedEmailDomains: ["spam.example.com", "junk.example.org"],
    });
  });

  it("maps server field paths onto the inputs", async () => {
    const onSave = vi
      .fn<(value: unknown) => Promise<void>>()
      .mockRejectedValue(
        new ApiRequestError("VALIDATION_FAILED", "x", undefined, 400, { fields: ["logoUrl"] }),
      );
    render(
      <SettingForm
        settingKey="branding"
        value={settingDefault("branding")}
        canWrite
        onSave={onSave}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("form.invalid"))).toBeTruthy();
    const logo = screen.getByLabelText(t("admin.settings.field.branding.logoUrl"));
    expect(logo.getAttribute("aria-invalid")).toBe("true");
  });

  it("has no save button and disabled controls when the account may only read", () => {
    render(
      <SettingForm
        settingKey="access"
        value={settingDefault("access")}
        canWrite={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: t("common.save") })).toBeNull();
    for (const input of screen.getAllByRole("checkbox")) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
  });
});

describe("settings presentation", () => {
  const leafPaths = (fields: readonly SettingField[]): SettingField[] =>
    fields.flatMap((field) =>
      field.kind === "group" ? [field, ...leafPaths(field.fields)] : [field],
    );

  /** Keys edited by the generic form somewhere in the admin (the rest have dedicated editors). */
  const GENERIC_PAGE_KEYS: SettingKey[] = [
    ...GENERAL_SETTINGS_GROUPS.flatMap((group) => group.keys),
    "billing",
    "rewards",
    "growth",
    "alerts",
    "medications",
  ];

  it("gives every settings key exactly one home", () => {
    const dedicated: SettingKey[] = ["branding", "whatsapp", "waAgent", "ai", "skills"];
    const homes = [...GENERIC_PAGE_KEYS, ...dedicated];
    expect([...homes].sort()).toEqual([...SETTING_KEYS].sort());
    expect(new Set(homes).size).toBe(homes.length);
  });

  it("labels every field of the generic pages in Arabic, so no raw key reaches the screen", () => {
    const dictionary = ar as Record<string, string>;
    for (const key of GENERIC_PAGE_KEYS) {
      expect(dictionary[`admin.settings.${key}.title`], key).toBeTruthy();
      expect(dictionary[`admin.settings.${key}.description`], key).toBeTruthy();
      for (const field of leafPaths(settingFields(SETTINGS_REGISTRY[key].schema))) {
        expect(
          dictionary[`admin.settings.field.${key}.${field.path}`],
          `${key}.${field.path}`,
        ).toBeTruthy();
      }
    }
  });

  it("keeps medications off the general page: it lives on /admin/drugs/recognition", () => {
    const general = GENERAL_SETTINGS_GROUPS.flatMap((group) => group.keys);
    expect(general).not.toContain("medications");
    expect(Object.hasOwn(SETTING_LAYOUTS, "medications")).toBe(true);
  });

  it("explains every medications field in plain words", () => {
    const dictionary = ar as Record<string, string>;
    for (const field of leafPaths(settingFields(SETTINGS_REGISTRY.medications.schema))) {
      expect(dictionary[`admin.settings.help.medications.${field.path}`], field.path).toBeTruthy();
    }
  });

  it("puts the two medications switches first, before any threshold", () => {
    renderForm("medications");
    const form = screen.getByRole("form", { name: t("admin.settings.medications.title") });
    const controls = [...form.querySelectorAll("input, select")].map((control) =>
      control.getAttribute("name"),
    );
    expect(controls.slice(0, 2)).toEqual(["enabled", "mode"]);
    expect(
      screen.getByRole("heading", { name: t("admin.settings.section.medications.status") }),
    ).toBeTruthy();
    expect(screen.getByText(t("admin.settings.help.medications.enabled"))).toBeTruthy();
  });

  it("no longer shows the retired rx.drugMatching switch, and saving the form still works", async () => {
    const onSave = renderForm("rx");
    expect(screen.queryByLabelText(t("admin.settings.field.rx.drugMatching"))).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ drugMatching: false });
  });

  it("places every field of a laid-out key in exactly one section", () => {
    for (const [key, sections] of Object.entries(SETTING_LAYOUTS)) {
      const names = settingFields(SETTINGS_REGISTRY[key as SettingKey].schema).map(
        (field) => field.name,
      );
      const placed = sections.flatMap((section) => section.paths);
      expect([...placed].sort(), key).toEqual([...names].sort());
    }
  });

  it("names only real number fields in the unit table", () => {
    for (const [entry, unit] of Object.entries(SETTING_UNITS)) {
      const [key, ...rest] = entry.split(".");
      const field = leafPaths(settingFields(SETTINGS_REGISTRY[key as SettingKey].schema)).find(
        (candidate) => candidate.path === rest.join("."),
      );
      expect(field?.kind, entry).toBe("number");
      expect(Object.hasOwn(ar, `admin.settings.unit.${unit}`), unit).toBe(true);
    }
  });

  it("edits percent and pounds and stores basis points and piasters unchanged", () => {
    const fields = settingFields(SETTINGS_REGISTRY.billing.schema);
    const scales = {
      maxTotalDiscountBps: UNIT_SCALE.bps ?? 1,
      minChargeMinor: UNIT_SCALE.minor ?? 1,
    };
    const draft = toDraft(fields, settingDefault("billing"), scales);
    expect(draft["maxTotalDiscountBps"]).toBe("70");
    expect(draft["minChargeMinor"]).toBe("10");
    const edited = fromDraft(
      fields,
      { ...draft, maxTotalDiscountBps: "12.5", minChargeMinor: "7.35" },
      scales,
    );
    expect(edited).toMatchObject({ maxTotalDiscountBps: 1_250, minChargeMinor: 735 });
    expect(SETTINGS_REGISTRY.billing.schema.safeParse(edited).success).toBe(true);
  });

  it("refuses a percent finer than one basis point instead of rounding it", async () => {
    const onSave = renderForm("billing");
    const discount = screen.getByLabelText(t("admin.settings.field.billing.maxTotalDiscountBps"));
    expect((discount as HTMLInputElement).value).toBe("70");
    await userEvent.clear(discount);
    await userEvent.type(discount, "12.345");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("admin.settings.error.tooPrecise"))).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a percent typed by the admin as basis points", async () => {
    const onSave = renderForm("growth");
    const guardrail = screen.getByLabelText(
      t("admin.settings.field.growth.experiments.guardrailBps"),
    );
    expect((guardrail as HTMLInputElement).value).toBe("5");
    await userEvent.clear(guardrail);
    await userEvent.type(guardrail, "7.5");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ experiments: { guardrailBps: 750 } });
  });
});
