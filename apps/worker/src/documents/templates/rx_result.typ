#set page(..a4-page)

#doc-title(labels.title, doc.at("date", default: none))

#text(fill: muted)[#labels.count]
#v(0.6em)

#if doc.rows.len() > 0 [
  #data-table((labels.name, labels.how), doc.rows)
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
