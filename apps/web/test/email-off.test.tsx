import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmailOff } from "../src/components/email-off";

describe("EmailOff", () => {
  it("puts Cloudflare's email_off markers around the address in the server HTML", () => {
    const html = renderToStaticMarkup(
      <EmailOff>
        <a href="mailto:hello@wasfa.online">hello@wasfa.online</a>
      </EmailOff>,
    );
    const open = html.indexOf("<!--email_off-->");
    const close = html.indexOf("<!--/email_off-->");
    const address = html.indexOf("hello@wasfa.online");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(open).toBeLessThan(address);
    expect(close).toBeGreaterThan(html.lastIndexOf("hello@wasfa.online"));
  });
});
