// 540 x 675 pt at 144 ppi is the 1080 x 1350 px picture.
#set page(width: 540pt, height: 675pt, margin: 0pt, fill: warm)

#let total = doc.lines.map(l => l.len()).sum() + doc.title.len()
#let size = if total > 700 { 12pt } else if total > 450 { 14pt } else if total > 250 { 16pt } else { 19pt }

#block(width: 100%, fill: primary, inset: (x: 36pt, y: 22pt))[
  #grid(
    columns: (1fr, auto),
    align: (start + horizon, end + horizon),
    text(weight: "bold", size: 20pt, fill: white)[#data.brand],
    text(size: 11pt, fill: accent)[#data.site],
  )
]

#block(width: 100%, inset: (x: 36pt, top: 30pt, bottom: 0pt))[
  #text(weight: "bold", size: size + 10pt, fill: primary)[#doc.title]
  #v(14pt)
  #for line in doc.lines [
    #block(below: 9pt)[
      #grid(
        columns: (14pt, 1fr),
        column-gutter: 8pt,
        align: (start + top, start + top),
        move(dy: 0.3em, circle(radius: 4pt, fill: accent)),
        text(size: size)[#line],
      )
    ]
  ]
]

#place(bottom, block(width: 100%, inset: (x: 36pt, bottom: 24pt))[
  #line(length: 100%, stroke: 0.6pt + muted)
  #v(4pt)
  #set text(size: 10pt, fill: muted)
  #if doc.at("footer", default: none) != none [#doc.footer #linebreak()]
  #data.generatedOn
])
