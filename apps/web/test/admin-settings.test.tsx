// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import {
  SETTING_KEYS,
  SETTINGS_REGISTRY,
  settingDefault,
  type SettingKey,
} from "@wasfa/shared/settings";
import { describe, expect, it, vi } from "vitest";

import { SettingForm } from "../src/components/admin/setting-form";
import { ApiRequestError } from "../src/lib/api-error";
import { fromDraft, settingFields, toDraft } from "../src/lib/setting-fields";

/** `skills` is a per-plan map edited on /admin/ai/skills, not a generated form. */
const FORM_KEYS = SETTING_KEYS.filter((key) => key !== "skills");

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
    })(settingFields(SETTINGS_REGISTRY[key].schema));
    expect(form.querySelectorAll("input, select, textarea")).toHaveLength(leaves);

    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(SETTINGS_REGISTRY[key].schema.safeParse(onSave.mock.calls[0]?.[0]).success).toBe(true);
    expect(onSave.mock.calls[0]?.[0]).toEqual(settingDefault(key));
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
