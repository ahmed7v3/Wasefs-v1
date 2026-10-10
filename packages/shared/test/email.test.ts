import { describe, expect, it } from "vitest";

import {
  CRITICAL_EMAIL_TEMPLATES,
  EMAIL_TEMPLATES,
  emailSecretContext,
  emailSendPayloadSchema,
  isCriticalEmail,
} from "../src/email.js";
import { parseJobPayload } from "../src/queues.js";

describe("email payloads", () => {
  it("needs an encrypted link for templates that carry one, and none for notices", () => {
    expect(
      emailSendPayloadSchema.safeParse({ template: "verify_email", to: "a@b.co" }).success,
    ).toBe(false);
    expect(
      emailSendPayloadSchema.safeParse({ template: "account_suspended", to: "A@B.co" }),
    ).toMatchObject({ success: true, data: { to: "a@b.co", locale: "ar", name: "" } });
  });

  it("strips unknown keys, so a plaintext link cannot ride along", () => {
    const parsed = emailSendPayloadSchema.parse({
      template: "reset_password",
      to: "a@b.co",
      encryptedLink: "v1.x.y.z",
      link: "https://wasfa.online/reset?token=secret",
    });
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  it("is registered on the notifications queue", () => {
    expect(parseJobPayload("notifications", "email.send", { template: "nope" }).ok).toBe(false);
  });

  it("treats only verification and reset as critical, with one AAD per template", () => {
    expect(CRITICAL_EMAIL_TEMPLATES).toEqual(["verify_email", "reset_password"]);
    expect(EMAIL_TEMPLATES.filter(isCriticalEmail)).toHaveLength(2);
    expect(new Set(EMAIL_TEMPLATES.map(emailSecretContext)).size).toBe(EMAIL_TEMPLATES.length);
  });
});
