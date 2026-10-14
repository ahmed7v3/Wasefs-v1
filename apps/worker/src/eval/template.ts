import { EVAL_SHEET_COLUMNS } from "@wasfa/shared/evals";
import ExcelJS from "exceljs";

/*
 * The label template (`evals/rx/template.xlsx`) is generated, not hand-made, so the columns the
 * importer expects and the columns the labeller sees cannot drift apart. The FIRST sheet is the one
 * that is imported; the second one only explains it.
 */

const WIDTHS: Record<(typeof EVAL_SHEET_COLUMNS)[number], number> = {
  image_file: 28,
  kind: 14,
  item_no: 9,
  drug: 26,
  strength: 14,
  form: 14,
  frequency: 18,
  duration: 16,
  route: 12,
};

const EXAMPLES: readonly (readonly string[])[] = [
  ["rx-001.jpg", "printed", "1", "Augmentin", "1 g", "tablet", "1x2", "7 days", "oral"],
  ["rx-001.jpg", "printed", "2", "Panadol", "500 mg", "tablet", "tid", "3 days", "oral"],
  [
    "rx-002-p1.jpg;rx-002-p2.jpg",
    "handwritten",
    "1",
    "Cataflam",
    "50 mg",
    "tablet",
    "bid",
    "5 days",
    "",
  ],
];

const HELP: readonly (readonly string[])[] = [
  ["image_file", "The picture file name. Several pages of one prescription: separate with ;"],
  ["kind", "printed or handwritten (the same for every row of one image)"],
  [
    "item_no",
    "Optional. The order of the drug on the paper (1, 2, 3). Rows keep their order if empty.",
  ],
  [
    "drug",
    "The drug exactly as written on the paper (brand or generic). Leave empty if the image has no drug.",
  ],
  [
    "strength",
    "As written, e.g. 500 mg. Leave empty if the paper does not say. Empty cells are not scored.",
  ],
  ["form", "tablet, syrup, ... (recorded, not scored)"],
  [
    "frequency",
    "As written: 1x3, bid, 3 times daily, ... The importer compares the meaning, not the spelling.",
  ],
  ["duration", "As written: 5 days, x 7, ..."],
  ["route", "oral, topical, ... (recorded, not scored)"],
];

/** The workbook as bytes. */
export async function buildLabelTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const labels = workbook.addWorksheet("Labels");
  labels.columns = EVAL_SHEET_COLUMNS.map((key) => ({ header: key, key, width: WIDTHS[key] }));
  labels.getRow(1).font = { bold: true };
  labels.views = [{ state: "frozen", ySplit: 1 }];
  // Row 1 is the header; the list stops a typo in the one column the importer is strict about.
  for (let row = 2; row <= 500; row++) {
    labels.getCell(`B${String(row)}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"printed,handwritten"'],
      showErrorMessage: true,
      errorTitle: "kind",
      error: "Use printed or handwritten",
    };
  }

  const help = workbook.addWorksheet("How to fill");
  help.columns = [
    { header: "column", key: "column", width: 14 },
    { header: "what to write", key: "what", width: 100 },
  ];
  help.getRow(1).font = { bold: true };
  for (const [column, what] of HELP) help.addRow({ column, what });
  help.addRow({});
  help.addRow({ column: "example", what: EVAL_SHEET_COLUMNS.join("  |  ") });
  for (const example of EXAMPLES) help.addRow({ column: "", what: example.join("  |  ") });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
