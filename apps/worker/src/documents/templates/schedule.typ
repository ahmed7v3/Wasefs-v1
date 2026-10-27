#set page(..a4-page)

#doc-title(doc.title, none)

#data-table(
  (labels.medicine, labels.dose, labels.times, labels.notes),
  doc.rows.map(r => (r.medicine, r.dose, r.times.join(data.sep), r.at("notes", default: ""))),
)

#v(1.2em)
#notice-box(data.disclaimer.title, data.disclaimer.text)
