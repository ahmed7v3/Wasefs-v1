import { describe, expect, it } from "vitest";

import { renderEmail } from "../src/notifications/templates/index.js";
import { assertWebLink, escapeHtml } from "../src/notifications/templates/layout.js";
import {
  CaptureTransport,
  PermanentMailError,
  classifySmtpError,
} from "../src/notifications/transport.js";

import type { Redis } from "ioredis";

const LINK = "https://api.wasfa.online/auth/verify-email?token=abc.def&callbackURL=%2Fonboarding";

describe("renderEmail", () => {
  it("renders the verification mail right-to-left in Arabic, in HTML and plain text", () => {
    const mail = renderEmail({
      template: "verify_email",
      locale: "ar",
      name: "أحمد",
      link: LINK,
    });
    expect(mail.subject).toBe("فعّل بريدك الإلكتروني في وصفة AI");
    expect(mail.html).toContain('<html lang="ar" dir="rtl">');
    expect(mail.html).toContain("direction:rtl");
    expect(mail.html).toContain("مرحبًا أحمد،");
    // `&` in the URL is escaped inside the attribute, and the visible fallback shows the link too.
    expect(mail.html).toContain(
      'href="https://api.wasfa.online/auth/verify-email?token=abc.def&amp;callbackURL=%2Fonboarding"',
    );
    expect(mail.text).toContain(LINK);
    expect(mail.text).toContain("تأكيد البريد الإلكتروني");
  });

  it("has no remote images, scripts or tracking pixels", () => {
    for (const mail of [
      renderEmail({ template: "verify_email", locale: "ar", name: "", link: LINK }),
      renderEmail({ template: "account_suspended", locale: "ar", name: "" }),
    ]) {
      expect(mail.html).not.toMatch(/<img|<script|<link|url\(|@import/i);
    }
  });

  it("renders English left-to-right and falls back to Arabic for untranslated keys", () => {
    const mail = renderEmail({ template: "reset_password", locale: "en", name: "Sam", link: LINK });
    expect(mail.html).toContain('<html lang="en" dir="ltr">');
    expect(mail.subject).toBe("Reset your Wasfa AI password");
    expect(mail.html).toContain("Hello Sam,");
  });

  it("escapes user-controlled text so a name cannot inject markup", () => {
    const mail = renderEmail({
      template: "org_invite",
      locale: "ar",
      name: '<img src=x onerror="alert(1)">',
      link: LINK,
      orgName: "<b>عيادة</b>",
      inviterName: "",
    });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>");
    expect(mail.html).toContain("&lt;b&gt;عيادة&lt;/b&gt;");
  });

  it("covers every template, and the suspension notice has no link and no ignore note", () => {
    const suspended = renderEmail({ template: "account_suspended", locale: "ar", name: "منى" });
    expect(suspended.html).not.toContain("href=");
    expect(suspended.text).not.toContain("http");
    expect(suspended.text).not.toContain("إن لم تطلب ذلك");
    const invite = renderEmail({
      template: "org_invite",
      locale: "ar",
      name: "",
      link: LINK,
      orgName: "عيادة النور",
      inviterName: "د. سارة",
    });
    expect(invite.subject).toContain("عيادة النور");
    expect(invite.text).toContain("د. سارة");
    expect(invite.text).toContain("مرحبًا،");
  });

  it("refuses links that are not http(s)", () => {
    expect(() => assertWebLink("javascript:alert(1)")).toThrow();
    expect(() => assertWebLink("data:text/html,x")).toThrow();
    expect(() => assertWebLink("not a url")).toThrow();
    expect(() =>
      renderEmail({
        template: "verify_email",
        locale: "ar",
        name: "",
        link: "javascript:alert(1)",
      }),
    ).toThrow();
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });
});

describe("classifySmtpError", () => {
  it("treats a 5xx answer and bad credentials as permanent, without copying the provider text", () => {
    const rejected = classifySmtpError({
      responseCode: 550,
      message: "550 5.1.1 <ali@example.com> user unknown",
    });
    expect(rejected).toBeInstanceOf(PermanentMailError);
    expect(rejected.message).toBe("SMTP rejected the message (550)");
    expect(rejected.message).not.toContain("ali@example.com");

    expect(classifySmtpError({ code: "EAUTH", message: "Invalid login" })).toBeInstanceOf(
      PermanentMailError,
    );
  });

  it("treats 4xx answers and network errors as transient", () => {
    const greylisted = classifySmtpError({ responseCode: 451, message: "try later" });
    expect(greylisted).not.toBeInstanceOf(PermanentMailError);
    expect(greylisted.message).toBe("SMTP delivery failed (451)");
    const timeout = classifySmtpError({ code: "ETIMEDOUT", message: "connect to 1.2.3.4" });
    expect(timeout).not.toBeInstanceOf(PermanentMailError);
    expect(timeout.message).toBe("SMTP delivery failed (ETIMEDOUT)");
  });
});

describe("CaptureTransport", () => {
  it("refuses to start in production", () => {
    expect(() => new CaptureTransport({} as Redis, "production")).toThrow(/production/);
    expect(() => new CaptureTransport({} as Redis, "development")).not.toThrow();
  });
});
