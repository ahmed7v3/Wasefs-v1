import { describe, expect, it } from "vitest";

import { csvCell, csvRow } from "../src/admin/ai/usage-csv.js";

describe("csvCell", () => {
  it.each(["=SUM(A1)", "+1", "-1+1", "@cmd", "\tx", "\rx"])(
    "defuses a formula start: %j",
    (text) => {
      const cell = csvCell(text);
      expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("quotes commas, quotes and line breaks, doubling inner quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("writes numbers, booleans and nulls as they are", () => {
    expect(csvRow([1, -2, true, null, undefined, "x"])).toBe("1,-2,true,,,x\r\n");
  });

  it("defuses and quotes together", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
});
