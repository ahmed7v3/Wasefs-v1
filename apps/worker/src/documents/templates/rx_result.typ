#set page(..a4-page)

// Everything shown comes from data.json (see data.ts, rxPdfDocSchema) and is only ever text.
#let hairline = rgb("#cbd5e1")
#let caution = rgb("#b45309")
#let sch = doc.schedule
#let cols = if sch != none { sch.columns } else { () }
#let has-notes = if sch != none { sch.rows.any(r => r.note != none) } else { false }

#doc-title(labels.title, doc.at("date", default: none))

#text(fill: muted)[#labels.count]
#v(0.6em)

// One card per medicine: name, strength and form, the facts the prescription gives, the first precautions.
#for item in doc.items [
  #block(width: 100%, breakable: false, stroke: 0.6pt + hairline, radius: 5pt, inset: 10pt, below: 0.9em)[
    #text(weight: "bold", size: 13pt, fill: primary)[#item.title]
    #if item.sub != "" [
      #h(0.5em)
      #text(size: 10.5pt, fill: muted)[#item.sub]
    ]
    #if item.flag != none [
      #linebreak()
      #text(size: 9.5pt, fill: caution)[#item.flag]
    ]
    #if item.facts.len() > 0 [
      #v(0.4em)
      #grid(
        columns: (auto, 1fr),
        column-gutter: 12pt,
        row-gutter: 5pt,
        ..item.facts.map(f => (
          text(weight: "bold", size: 10pt, fill: muted)[#f.label],
          text(size: 10.5pt)[#f.value],
        )).flatten()
      )
    ]
    #if item.precautions.len() > 0 [
      #v(0.4em)
      #text(weight: "bold", size: 10pt, fill: caution)[#item.precautionsLabel]
      #list(..item.precautions.map(p => text(size: 10pt)[#p]))
    ]
  ]
]

// The suggested dosing timetable: a row per medicine, a column per suggested clock time, an empty
// box where the medicine is due. A medicine without readable times gets a note instead of boxes.
#if sch != none [
  #v(0.6em)
  #block(breakable: false, below: 0.6em)[#text(weight: "bold", size: 15pt, fill: primary)[#sch.title]]
  #table(
    columns: (3fr,) + cols.map(_ => 1fr) + (if has-notes { (2fr,) } else { () }),
    fill: (_, y) => if y == 0 { soft } else if calc.odd(y) { rgb("#f8fafc") } else { white },
    stroke: 0.5pt + hairline,
    inset: 7pt,
    align: (x, _) => if x == 0 { start + horizon } else { center + horizon },
    table.header(
      text(weight: "bold", fill: primary)[#sch.medicineLabel],
      ..cols.map(c => [
        #text(weight: "bold", fill: primary)[#c.time]
        #linebreak()
        #text(size: 8.5pt, fill: muted)[#c.slot]
      ]),
      ..(if has-notes { (text(weight: "bold", fill: primary)[#sch.notesLabel],) } else { () }),
    ),
    ..sch.rows.map(r => (
      [#r.name],
      ..r.cells.map(on => if on { box(width: 11pt, height: 11pt, stroke: 0.9pt + primary, radius: 2pt) } else { [] }),
      ..(if has-notes { (if r.note != none [#r.note] else [],) } else { () }),
    )).flatten()
  )
  #v(0.4em)
  #text(size: 9.5pt, fill: muted)[#sch.note]
]

#if doc.at("overview", default: none) != none [
  #v(1em)
  #block(width: 100%, fill: soft, inset: 10pt, radius: 4pt, breakable: false)[
    #text(weight: "bold", fill: primary)[#doc.overview.title]
    #linebreak()
    #text(size: 10pt)[#doc.overview.text]
  ]
]

#if doc.at("unreadable", default: none) != none [
  #v(1em)
  #block(width: 100%, fill: warm, inset: 10pt, radius: 4pt)[#text(size: 10pt)[#doc.unreadable]]
]

#v(1.2em)
#notice-box(data.disclaimer.title, data.disclaimer.text)

#if doc.at("link", default: none) != none [
  #v(1em)
  #text(size: 10pt, fill: muted)[#labels.link]
  #linebreak()
  #text(size: 10pt, fill: primary)[#doc.link]
]
