import { describe, expect, it } from "vitest";

import { minimalEdit } from "../src/lib/content-editor/textarea-edit";
import {
  applySlashCommand,
  applyToolbarAction,
  filterSlashCommands,
  matchSlashCommand,
  type TextState,
  type ToolbarAction,
} from "../src/lib/content-editor/toolbar";

const at = (value: string, selStart: number, selEnd = selStart): TextState => ({
  value,
  selStart,
  selEnd,
});
const sel = (s: TextState): string => s.value.slice(s.selStart, s.selEnd);

describe("applyToolbarAction: inline markers", () => {
  it("wraps a selection in bold and keeps it selected", () => {
    const out = applyToolbarAction(at("hello world", 0, 5), "bold");
    expect(out.value).toBe("**hello** world");
    expect(sel(out)).toBe("hello");
  });

  it("unwraps when the markers sit outside the selection", () => {
    const out = applyToolbarAction(at("**hello** world", 2, 7), "bold");
    expect(out.value).toBe("hello world");
    expect(sel(out)).toBe("hello");
  });

  it("unwraps when the selection includes the markers", () => {
    expect(applyToolbarAction(at("**hello**", 0, 9), "bold").value).toBe("hello");
  });

  it("inserts an empty pair with the caret inside when nothing is selected", () => {
    const out = applyToolbarAction(at("ab", 1), "bold");
    expect(out.value).toBe("a****b");
    expect(out.selStart).toBe(3);
  });

  it("italic does not unwrap bold, and bold+italic toggles independently", () => {
    const both = applyToolbarAction(at("**x**", 2, 3), "italic");
    expect(both.value).toBe("***x***");
    const back = applyToolbarAction(at(both.value, 3, 4), "italic");
    expect(back.value).toBe("**x**");
  });

  it("wraps Arabic text and keeps whitespace outside the markers", () => {
    const out = applyToolbarAction(at("اقرأ  الدواء جيدا", 4, 12), "bold");
    expect(out.value).toBe("اقرأ  **الدواء** جيدا");
  });

  it("wraps each paragraph of a multi-paragraph selection separately", () => {
    expect(applyToolbarAction(at("one\n\ntwo", 0, 8), "bold").value).toBe("**one**\n\n**two**");
  });
});

describe("applyToolbarAction: line prefixes", () => {
  it("makes a heading and toggles it off", () => {
    const on = applyToolbarAction(at("Title", 2), "h2");
    expect(on.value).toBe("## Title");
    expect(on.selStart).toBe(5);
    expect(applyToolbarAction(on, "h2").value).toBe("Title");
  });

  it("switches h2 to h3 instead of stacking", () => {
    expect(applyToolbarAction(at("## Title", 4), "h3").value).toBe("### Title");
  });

  it("bullets every line of a multi-line selection and skips blank lines", () => {
    expect(applyToolbarAction(at("a\n\nb", 0, 4), "bullet").value).toBe("- a\n\n- b");
  });

  it("numbers lines sequentially and removes numbering again", () => {
    const on = applyToolbarAction(at("a\nb\nc", 0, 5), "numbered");
    expect(on.value).toBe("1. a\n2. b\n3. c");
    expect(applyToolbarAction(at(on.value, 0, on.value.length), "numbered").value).toBe("a\nb\nc");
  });

  it("replaces a bullet with a number", () => {
    expect(applyToolbarAction(at("- a", 0, 3), "numbered").value).toBe("1. a");
  });

  it("quotes and unquotes, keeping list markers inside the quote", () => {
    const q = applyToolbarAction(at("- a", 0, 3), "quote");
    expect(q.value).toBe("> - a");
    expect(applyToolbarAction(at(q.value, 0, q.value.length), "quote").value).toBe("- a");
  });

  it("a selection ending at the start of the next line does not touch that line", () => {
    expect(applyToolbarAction(at("a\nb", 0, 2), "bullet").value).toBe("- a\nb");
  });

  it("works on Arabic lines", () => {
    expect(applyToolbarAction(at("مقدمة", 0), "h2").value).toBe("## مقدمة");
  });
});

describe("applyToolbarAction: blocks and entities", () => {
  it("wraps lines in a callout with blank lines around and unwraps it again", () => {
    const on = applyToolbarAction(at("before\n\nwarn me\n\nafter", 8, 15), "warning");
    expect(on.value).toBe("before\n\n:::warning\nwarn me\n:::\n\nafter");
    const off = applyToolbarAction(at(on.value, on.selStart, on.selEnd), "warning");
    expect(off.value).toBe("before\n\nwarn me\n\nafter");
  });

  it("relabels a callout of another kind", () => {
    expect(applyToolbarAction(at(":::note\nx\n:::", 9), "tip").value).toBe(":::tip\nx\n:::");
  });

  it("inserts an empty callout with the caret on the middle line", () => {
    const out = applyToolbarAction(at("", 0), "note");
    expect(out.value).toBe(":::note\n\n:::\n");
    expect(out.selStart).toBe(8);
  });

  it("inserts a GFM table after the current line and selects the first header", () => {
    const out = applyToolbarAction(at("intro", 5), "table", { tableLabels: ["A", "B"] });
    expect(out.value).toBe("intro\n\n| A | B |\n| --- | --- |\n|  |  |\n");
    expect(sel(out)).toBe("A");
  });

  it("inserts the CTA directive as its own block", () => {
    expect(applyToolbarAction(at("text", 4), "cta").value).toBe("text\n\n{{cta:analyze}}\n");
  });

  it("drug / glossary links need a valid slug; without one they leave a pair to fill", () => {
    expect(applyToolbarAction(at("x ", 2), "drug", { slug: "Paracetamol" }).value).toBe(
      "x {{drug:paracetamol}}",
    );
    const empty = applyToolbarAction(at("x ", 2), "glossary");
    expect(empty.value).toBe("x {{glossary:}}");
    expect(empty.selStart).toBe(empty.value.length - 2);
    expect(applyToolbarAction(at("x", 1), "drug", { slug: "bad slug!" }).value).toBe("x{{drug:}}");
  });

  it("inserts a library image with alt and caption, and does nothing without an id", () => {
    const out = applyToolbarAction(at("", 0), "image", {
      mediaId: "abc",
      alt: "علبة [دواء]",
      caption: 'say "hi"',
    });
    expect(out.value).toBe("![علبة دواء](media:abc \"say 'hi'\")\n");
    expect(applyToolbarAction(at("x", 1), "image").value).toBe("x");
  });

  it("links: wraps a selection, unwraps a markdown link, keeps a pasted URL as the target", () => {
    const wrapped = applyToolbarAction(at("see this", 4, 8), "link");
    expect(wrapped.value).toBe("see [this]()");
    expect(wrapped.selStart).toBe(wrapped.value.length - 1);
    expect(applyToolbarAction(at("[a](/b)", 0, 7), "link").value).toBe("a");
    expect(applyToolbarAction(at("https://x.com", 0, 13), "link").value).toBe("[](https://x.com)");
    expect(applyToolbarAction(at("", 0), "link", { url: "/blog/x", label: "x" }).value).toBe(
      "[x](/blog/x)",
    );
  });

  it("footnote adds the reference at the caret and the definition at the end", () => {
    const out = applyToolbarAction(at("fact. more", 5), "footnote");
    expect(out.value).toBe("fact.[^1] more\n\n[^1]: ");
    expect(out.selStart).toBe(out.value.length);
    expect(applyToolbarAction(at("a\n\n[^1]: x", 1), "footnote").value).toContain("[^2]");
  });
});

describe("slash commands", () => {
  const label = (a: ToolbarAction): string => a;

  it("matches only a slash at the start of a line, with no spaces", () => {
    expect(matchSlashCommand("/", 1)).toEqual({ from: 0, to: 1, query: "" });
    expect(matchSlashCommand("text\n/ta", 8)).toEqual({ from: 5, to: 8, query: "ta" });
    expect(matchSlashCommand("a /b", 4)).toBeNull();
    expect(matchSlashCommand("/a b", 4)).toBeNull();
    expect(matchSlashCommand("/blog/x", 7)).toBeNull();
  });

  it("filters by alias and label; an empty query lists everything", () => {
    expect(filterSlashCommands("", label)).toHaveLength(17);
    expect(filterSlashCommands("tab", label)).toEqual(["table"]);
    expect(filterSlashCommands("عنوان", (a) => (a === "h2" ? "عنوان رئيسي" : a))).toEqual(["h2"]);
    expect(filterSlashCommands("zzz", label)).toEqual([]);
  });

  it("removes the typed command before applying it", () => {
    const state = at("/tab", 4);
    const match = matchSlashCommand(state.value, 4);
    if (!match) throw new Error("no match");
    expect(applySlashCommand(state, match, "h2").value).toBe("## ");
  });
});

describe("minimalEdit", () => {
  it("finds the smallest replacement", () => {
    expect(minimalEdit("hello world", "hello brave world")).toEqual({
      start: 6,
      end: 6,
      insert: "brave ",
    });
    expect(minimalEdit("abc", "abc")).toEqual({ start: 3, end: 3, insert: "" });
    expect(minimalEdit("abcd", "ad")).toEqual({ start: 1, end: 3, insert: "" });
  });
});
