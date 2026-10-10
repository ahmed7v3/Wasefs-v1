import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tab, TabList, TabPanel, Tabs } from "../src";

function Example({ dir }: { dir: "rtl" | "ltr" }) {
  return (
    <div dir={dir}>
      <Tabs defaultValue="email">
        <TabList aria-label="طريقة الدخول">
          <Tab value="email">البريد</Tab>
          <Tab value="phone">الهاتف</Tab>
          <Tab value="code">الرمز</Tab>
        </TabList>
        <TabPanel value="email">لوحة البريد</TabPanel>
        <TabPanel value="phone">لوحة الهاتف</TabPanel>
        <TabPanel value="code">لوحة الرمز</TabPanel>
      </Tabs>
    </div>
  );
}

const selectedTab = () => screen.getByRole("tab", { selected: true }).textContent;

describe("Tabs", () => {
  it("wires roles, roving tabindex and panels", () => {
    render(<Example dir="rtl" />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "البريد" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "الهاتف" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("tabpanel").textContent).toBe("لوحة البريد");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      screen.getByRole("tab", { name: "البريد" }).id,
    );
  });

  it("in RTL, ArrowLeft moves to the NEXT tab and ArrowRight to the previous", async () => {
    const user = userEvent.setup();
    render(<Example dir="rtl" />);
    screen.getByRole("tab", { name: "البريد" }).focus();

    await user.keyboard("{ArrowLeft}");
    expect(selectedTab()).toBe("الهاتف");
    expect(document.activeElement?.textContent).toBe("الهاتف");

    await user.keyboard("{ArrowRight}");
    expect(selectedTab()).toBe("البريد");
  });

  it("in LTR, ArrowRight moves to the next tab and ArrowLeft to the previous", async () => {
    const user = userEvent.setup();
    render(<Example dir="ltr" />);
    screen.getByRole("tab", { name: "البريد" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(selectedTab()).toBe("الهاتف");

    await user.keyboard("{ArrowLeft}");
    expect(selectedTab()).toBe("البريد");
  });

  it("wraps around, and Home/End jump to the ends", async () => {
    const user = userEvent.setup();
    render(<Example dir="ltr" />);
    screen.getByRole("tab", { name: "البريد" }).focus();

    await user.keyboard("{ArrowLeft}");
    expect(selectedTab()).toBe("الرمز");
    await user.keyboard("{Home}");
    expect(selectedTab()).toBe("البريد");
    await user.keyboard("{End}");
    expect(selectedTab()).toBe("الرمز");
    expect(screen.getByRole("tabpanel").textContent).toBe("لوحة الرمز");
  });

  it("selects on click", async () => {
    const user = userEvent.setup();
    render(<Example dir="rtl" />);
    await user.click(screen.getByRole("tab", { name: "الهاتف" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("لوحة الهاتف");
  });
});
