/*
 * Strings of the public content pages (blog, guides, glossary, authors, preview; WP3). They live in the
 * public catalogue (`public.ts`) because the copy-link island on those pages is a client component.
 * The article text itself comes stored in the content's own language, never from here.
 */
export const arPublicContent = {
  "content.nav.blog": "المدونة",
  "content.nav.guides": "الأدلة",
  "content.nav.glossary": "المصطلحات",
  "content.footer.resources": "الموارد",
  "content.breadcrumb.label": "مسار الصفحة",

  "content.blog.title": "مدونة وصفة AI",
  "content.blog.lead": "مقالات واضحة ومراجعة طبيًا عن الأدوية والروشتات وصحتك اليومية.",
  "content.blog.metaTitle": "المدونة",
  "content.blog.metaDescription":
    "مقالات عربية مبسطة ومراجعة طبيًا عن قراءة الروشتة وفهم الأدوية وتعليمات العلاج.",
  "content.guides.title": "الأدلة",
  "content.guides.lead": "أدلة شاملة خطوة بخطوة تشرح موضوعًا واحدًا من أوله إلى آخره.",
  "content.guides.metaTitle": "الأدلة الشاملة",
  "content.guides.metaDescription":
    "أدلة تعليمية شاملة تشرح كيف تقرأ الروشتة وتفهم أدويتك وتتابع علاجك بأمان.",
  "content.glossary.title": "مسرد مصطلحات الروشتة",
  "content.glossary.lead": "معاني الاختصارات والمصطلحات الطبية التي تظهر في الروشتة، بلغة بسيطة.",
  "content.glossary.metaTitle": "مسرد مصطلحات الروشتة والاختصارات الطبية",
  "content.glossary.metaDescription":
    "معنى الاختصارات والمصطلحات الطبية في الروشتة مثل BID وTID وPRN، مشروحة بلغة بسيطة.",
  "content.glossary.jump.label": "القفز إلى حرف",
  "content.glossary.jump.latin": "A–Z",
  "content.glossary.jump.arabic": "أ–ي",
  "content.glossary.jump.other": "#",

  "content.all": "الكل",
  "content.categories.label": "التصنيفات",
  "content.category.label": "تصنيف",
  "content.tag.label": "وسم",
  "content.list.count": "{n} مقالة",
  "content.list.page": "الصفحة {n}",

  "content.empty.title": "لا يوجد محتوى منشور هنا بعد",
  "content.empty.hint": "نعمل على محتوى جديد. عد قريبًا أو تصفح باقي الأقسام.",
  "content.empty.home": "العودة إلى الرئيسية",

  "content.pagination.label": "التنقل بين الصفحات",
  "content.pagination.prev": "السابق",
  "content.pagination.next": "التالي",
  "content.pagination.page": "الصفحة {n}",

  "content.card.readMinutes": "{n} دقيقة قراءة",
  "content.by": "بقلم",
  "content.published": "نُشر في",
  "content.updated": "آخر تحديث",
  "content.reviewed.by": "راجعه طبيًا:",
  "content.reviewed.on": "بتاريخ",
  "content.reviewed.licence": "ترخيص رقم {number}",

  "content.toc.title": "محتويات الصفحة",
  "content.corrections.title": "تصحيحات",
  "content.aiNote": "كُتب بمساعدة أدوات ذكاء اصطناعي، ومرّ بمراجعة بشرية قبل النشر.",
  "content.sponsored": "محتوى برعاية",
  "content.related.title": "اقرأ أيضًا",
  "content.medicalNote": "هذه المعلومات للتثقيف ولا تغني عن استشارة الطبيب أو الصيدلي.",
  "content.medicalNote.link": "إخلاء المسؤولية الطبية",
  "content.definition": "التعريف",

  "content.share.title": "شارك الصفحة",
  "content.share.whatsapp": "واتساب",
  "content.share.facebook": "فيسبوك",
  "content.share.x": "إكس",
  "content.share.telegram": "تيليجرام",
  "content.share.copy": "نسخ الرابط",
  "content.share.copied": "تم نسخ الرابط",

  "content.preview.banner": "معاينة — غير منشور",
  "content.preview.expires": "الرابط مؤقت وغير مفهرس",

  "content.author.articles": "المقالات",
  "content.author.credentials": "المؤهلات",
  "content.author.sameAs": "حسابات وروابط أخرى",
  "content.author.metaSuffix": "كاتب في وصفة AI",
} as const;
