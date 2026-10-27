// Shared by every template: the worker puts this file in front of the chosen template and compiles
// the two together as main.typ. All content comes from data.json and is only ever shown as text.
#let data = json("data.json")
#let doc = data.doc
#let labels = data.labels
#let primary = rgb("#1e3a8a")
#let accent = rgb("#60a5fa")
#let soft = rgb("#e6f1fe")
#let warm = rgb("#f6f6f4")
#let ink = rgb("#0b1220")
#let muted = rgb("#4a5670")

#set text(font: "IBM Plex Sans Arabic", lang: data.lang, size: 11pt, fill: ink)
#set par(leading: 0.85em, spacing: 1em)

#let doc-header = [
  #grid(
    columns: (1fr, auto),
    align: (start + horizon, end + horizon),
    text(weight: "bold", size: 15pt, fill: primary)[#data.brand],
    text(size: 9pt, fill: muted)[#data.site],
  )
  #v(-0.4em)
  #line(length: 100%, stroke: 0.8pt + primary)
]

#let doc-footer = context [
  #set text(size: 8.5pt, fill: muted)
  #line(length: 100%, stroke: 0.4pt + muted)
  #v(-0.3em)
  #grid(
    columns: (1fr, auto),
    align: (start, end),
    [#data.generatedOn],
    [#data.pageLabel #counter(page).display() / #counter(page).final().first()],
  )
]

#let a4-page = (
  paper: "a4",
  margin: (x: 2cm, top: 3cm, bottom: 2.4cm),
  header: doc-header,
  footer: doc-footer,
  header-ascent: 30%,
)

#let doc-title(title, subtitle) = [
  #block(below: if subtitle == none { 1.1em } else { 0.6em })[#text(weight: "bold", size: 22pt, fill: primary)[#title]]
  #if subtitle != none [
    #block(below: 1em)[#text(size: 12pt, fill: muted)[#subtitle]]
  ]
]

#let notice-box(title, body) = block(
  width: 100%,
  fill: rgb("#fff7ed"),
  stroke: 0.8pt + rgb("#fdba74"),
  inset: 10pt,
  radius: 4pt,
  breakable: false,
)[
  #text(weight: "bold")[#title]
  #linebreak()
  #text(size: 10pt)[#body]
]

#let data-table(columns, rows) = table(
  columns: columns.map(_ => 1fr),
  fill: (_, y) => if y == 0 { soft } else if calc.odd(y) { rgb("#f8fafc") } else { white },
  stroke: 0.5pt + rgb("#cbd5e1"),
  inset: 7pt,
  align: start + horizon,
  table.header(..columns.map(c => text(weight: "bold", fill: primary)[#c])),
  ..rows.flatten().map(c => [#c]),
)
