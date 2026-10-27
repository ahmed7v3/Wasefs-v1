#set page(..a4-page)

#doc-title(doc.title, none)

#data-table(doc.columns, doc.rows)

#if doc.at("notes", default: none) != none [
  #v(1em)
  #block(width: 100%, fill: warm, inset: 10pt, radius: 4pt)[#text(size: 10pt, fill: muted)[#doc.notes]]
]
