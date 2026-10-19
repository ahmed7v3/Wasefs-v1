/* Settings > Search and discoverability (the `seo` key, SEO-GEO §13). */
export const arAdminSeo = {
  "admin.settings.group.seo": "البحث والظهور",
  "admin.settings.group.seo.description":
    "ما يظهر في نتائج محركات البحث ومساعدات الذكاء الاصطناعي، ومن يُسمح له بزيارة الموقع، وإبلاغ المحركات بالصفحات الجديدة.",
  "admin.settings.seo.title": "البحث والظهور",
  "admin.settings.seo.description":
    "عنوان الصفحات ووصفها الافتراضي، وإثبات ملكية الموقع، وسياسة زواحف الذكاء الاصطناعي، وإشعار IndexNow. هذه القيم ظاهرة للعامة.",
  "admin.settings.section.seo.snippets": "العناوين والمعاينة",
  "admin.settings.section.seo.snippets.description":
    "كيف تظهر صفحات الموقع في نتائج البحث وعند مشاركتها.",
  "admin.settings.section.seo.verification": "إثبات ملكية الموقع",
  "admin.settings.section.seo.verification.description":
    "رموز التحقق من أدوات مشرفي المواقع. تُضاف إلى وسوم الصفحة الرئيسية.",
  "admin.settings.section.seo.aiCrawlers": "زواحف الذكاء الاصطناعي",
  "admin.settings.section.seo.aiCrawlers.description":
    "فعّل لكل زاحف السماح بزيارة صفحات الموقع العامة. محركات البحث التقليدية مسموحة دائمًا، ويُحجب الدخول لصفحات التطبيق عن الجميع.",
  "admin.settings.section.seo.indexNow": "إشعار IndexNow",
  "admin.settings.section.seo.indexNow.description":
    "إبلاغ بينج وياندكس وغيرهما فور نشر صفحة أو تعديلها. يلزم مفتاح، ويُنشر ملفه تلقائيًا على الموقع.",
  "admin.settings.section.seo.llms": "ملف llms.txt",
  "admin.settings.section.seo.llms.description":
    "ملخص للموقع مكتوب لنماذج الذكاء الاصطناعي. تجريبي وبلا ضرر.",
  "admin.settings.section.seo.reports": "تقارير البحث",
  "admin.settings.section.seo.reports.description":
    "كيف تفرز التقارير عمليات البحث باسم العلامة، والمواقع التي تُعدّ زيارات قادمة من مساعدات الذكاء الاصطناعي.",
  "admin.settings.field.seo.titleTemplate": "قالب عنوان الصفحة",
  "admin.settings.help.seo.titleTemplate":
    "يجب أن يحتوي على %s ليحل محله عنوان الصفحة، مثل «%s | وصفة AI». اتركه فارغًا لاستخدام القالب المدمج.",
  "admin.settings.field.seo.defaultDescription": "الوصف الافتراضي",
  "admin.settings.help.seo.defaultDescription": "يظهر حين لا يكون للصفحة وصف خاص. حتى 300 حرف.",
  "admin.settings.field.seo.defaultOgImage": "صورة المعاينة الافتراضية",
  "admin.settings.help.seo.defaultOgImage":
    "رابط صورة 1200×630 تظهر عند مشاركة الصفحات التي لا صورة لها.",
  "admin.settings.field.seo.verification": "رموز التحقق",
  "admin.settings.field.seo.verification.google": "جوجل (Search Console)",
  "admin.settings.field.seo.verification.bing": "بينج (Webmaster Tools)",
  "admin.settings.field.seo.verification.yandex": "ياندكس (Webmaster)",
  "admin.settings.help.seo.verification.google":
    "قيمة content في وسم google-site-verification فقط، دون باقي الوسم.",
  "admin.settings.field.seo.aiCrawlers": "السماح للزواحف",
  "admin.settings.field.seo.aiCrawlers.GPTBot": "GPTBot — OpenAI: تدريب النماذج",
  "admin.settings.field.seo.aiCrawlers.OAI-SearchBot": "OAI-SearchBot — OpenAI: نتائج بحث ChatGPT",
  "admin.settings.field.seo.aiCrawlers.ChatGPT-User": "ChatGPT-User — OpenAI: جلب صفحة بطلب مستخدم",
  "admin.settings.field.seo.aiCrawlers.ClaudeBot": "ClaudeBot — Anthropic: تدريب النماذج",
  "admin.settings.field.seo.aiCrawlers.Claude-SearchBot":
    "Claude-SearchBot — Anthropic: بحث Claude",
  "admin.settings.field.seo.aiCrawlers.Claude-User":
    "Claude-User — Anthropic: جلب صفحة بطلب مستخدم",
  "admin.settings.field.seo.aiCrawlers.PerplexityBot":
    "PerplexityBot — Perplexity: فهرسة نتائج البحث",
  "admin.settings.field.seo.aiCrawlers.Perplexity-User":
    "Perplexity-User — Perplexity: جلب صفحة بطلب مستخدم",
  "admin.settings.field.seo.aiCrawlers.Google-Extended":
    "Google-Extended — جوجل: تدريب Gemini والإجابات المدعومة بالمصادر (لا يؤثر على نتائج البحث)",
  "admin.settings.field.seo.aiCrawlers.Applebot-Extended":
    "Applebot-Extended — آبل: السماح باستخدام المحتوى في تدريب نماذج آبل",
  "admin.settings.field.seo.aiCrawlers.CCBot":
    "CCBot — Common Crawl: أرشيف يستخدمه كثير من مطوري النماذج",
  "admin.settings.field.seo.indexNow": "IndexNow",
  "admin.settings.field.seo.indexNow.enabled": "تفعيل الإشعار",
  "admin.settings.field.seo.indexNow.key": "المفتاح",
  "admin.settings.help.seo.indexNow.key":
    "من 8 إلى 128 حرفًا أو رقمًا أو شرطة. يُفضَّل 32 حرفًا عشوائيًا (حروف a-f وأرقام).",
  "admin.settings.field.seo.llmsTxt": "ملف llms.txt",
  "admin.settings.field.seo.llmsTxt.enabled": "نشر الملف",
  "admin.settings.field.seo.brandRegex": "نمط اسم العلامة",
  "admin.settings.help.seo.brandRegex":
    "تعبير نمطي لا يتأثر بحالة الأحرف، مثل «wasfa|وصفة». ما يطابقه يُعدّ بحثًا باسم العلامة.",
  "admin.settings.field.seo.aiReferrerHosts": "مواقع مساعدات الذكاء الاصطناعي",
  "admin.settings.help.seo.aiReferrerHosts":
    "الزيارات القادمة من هذه المواقع تُحسب زيارات من الذكاء الاصطناعي.",
} as const;
