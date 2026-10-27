#set page(..a4-page)
#set heading(numbering: none)
#show heading.where(level: 2): it => block(above: 1.4em, below: 0.7em)[#text(size: 14pt, weight: "bold", fill: primary)[#it.body]]

#doc-title(doc.title, doc.at("subtitle", default: none))

#for section in doc.sections [
  == #section.heading
  #for p in section.paragraphs [
    #p
    #parbreak()
  ]
  #if section.at("bullets", default: ()).len() > 0 [
    #list(..section.bullets)
  ]
]

#if doc.at("footerNote", default: none) != none [
  #v(1em)
  #block(width: 100%, fill: warm, inset: 10pt, radius: 4pt)[#text(size: 10pt, fill: muted)[#doc.footerNote]]
]
