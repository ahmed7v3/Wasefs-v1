/*
 * Landing page copy (Arabic). Components render this; they never contain their own text.
 *
 * Voice rules (AGENT.md §5.11 and the product phase): the product assists and never diagnoses; the
 * analyzer is not live yet, so every call to action is "create a free account" or "get early
 * access", never "try it now"; no invented numbers, ratings, testimonials or certifications.
 * "In seconds" is the product goal, not a measured figure, so it carries no number.
 */

/** The mascot family (components/marketing/mascot.tsx draws one symbol per name). */
export type MascotName = "star" | "capsule" | "hexagon" | "droplet" | "tablet" | "blob" | "clover";
/** Colour family of a skill or audience card; the component maps it to token classes. */
export type Tone = "navy" | "coral" | "teal" | "amber" | "olive" | "indigo";
export type AudienceIcon = "patient" | "pharmacist" | "doctor" | "organization";
export type PipelineIcon = "scan" | "read" | "database" | "gauge";
export type TrustIcon = "shield" | "lock" | "stethoscope" | "languages";

export interface LandingStep {
  title: string;
  body: string;
}

export interface LandingSkill {
  mascot: MascotName;
  tone: Tone;
  title: string;
  body: string;
  /** Shown as a "coming soon" badge when the capability is not live yet. */
  soon: boolean;
}

export interface LandingAudience {
  icon: AudienceIcon;
  tone: Tone;
  title: string;
  body: string;
  points: string[];
  soon: boolean;
}

export interface LandingPipelineStep {
  icon: PipelineIcon;
  title: string;
  body: string;
}

export interface LandingTrustItem {
  icon: TrustIcon;
  title: string;
  body: string;
}

export interface VisualItem {
  name: string;
  detail: string;
  /** `review` marks a low-confidence line, drawn in the warning style. */
  flag: "review" | null;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export const landing = {
  hero: {
    pill: "صُمِّم للمريض والصيدلي والطبيب العربي",
    titleLines: ["افهم روشتتك في ثوانٍ.", "بدقة تراجع نفسها."],
    lead: "وصفة AI مساعد عربي يقرأ صورة الروشتة المكتوبة بخط اليد أو المطبوعة، ويحوّلها إلى بطاقة واضحة بأسماء الأدوية والجرعات ومرات الاستخدام والتحذيرات. وما لا نتأكد منه نضعه أمامك لتراجعه مع طبيبك أو صيدلي.",
    primaryCta: "أنشئ حسابك المجاني",
    secondaryCta: "كيف تعمل؟",
    reassurance: "قريبًا · إنشاء الحساب مجاني ولا يحتاج إلى بطاقة بنكية.",
    haveAccount: "لديك حساب بالفعل؟",
    signIn: "تسجيل الدخول",
  },

  /** The illustration beside the hero headline: a sample, not a real result. */
  visual: {
    alt: "مثال توضيحي: روشتة مكتوبة بخط اليد يمسحها شعاع ضوئي فتتحول إلى بنود منظمة بأسماء الأدوية والجرعات، وبند غير واضح مُعلَّم للمراجعة.",
    sampleBadge: "مثال توضيحي",
    paperTitle: "الروشتة",
    resultTitle: "النتيجة المنظمة",
    resultMeta: "3 أدوية",
    items: [
      { name: "باراسيتامول 500 مجم", detail: "قرص كل 8 ساعات · 3 أيام", flag: null },
      { name: "أموكسيسيلين 500 مجم", detail: "كبسولة كل 12 ساعة · 7 أيام", flag: null },
      { name: "اسم غير واضح", detail: "يُنصح بمراجعته مع الصيدلي", flag: "review" },
    ] satisfies VisualItem[],
    confidenceHigh: "ثقة عالية",
    review: "راجع الصيدلي",
    note: "وصفة AI تساعد ولا تشخّص",
  },

  skills: {
    id: "features",
    eyebrow: "مهارات وصفة",
    title: "فريق من المهارات، لكل مهارة وجهها ومهمتها",
    lead: "تتوسع وصفة AI بمهارات متخصصة تُضاف تباعًا، وكلها تساعدك على الفهم ولا تحل محل الطبيب أو الصيدلي.",
    items: [
      {
        mascot: "capsule",
        tone: "navy",
        title: "قراءة الروشتة",
        body: "تحوّل صورة الروشتة، بخط اليد أو المطبوعة، إلى بطاقة عربية منظمة.",
        soon: true,
      },
      {
        mascot: "hexagon",
        tone: "coral",
        title: "التداخلات الدوائية",
        body: "تنبّهك إلى الأدوية التي قد يتعارض بعضها مع بعض لتسأل عنها الصيدلي.",
        soon: true,
      },
      {
        mascot: "droplet",
        tone: "teal",
        title: "الجرعات والتعليمات",
        body: "الجرعة وعدد المرات والمدة وتعليمات الاستخدام في سطر واحد واضح.",
        soon: true,
      },
      {
        mascot: "tablet",
        tone: "amber",
        title: "شرح الدواء للمريض",
        body: "اسأل بالعربية عن أي دواء واحصل على شرح مبسّط بلغة قريبة منك.",
        soon: true,
      },
      {
        mascot: "blob",
        tone: "olive",
        title: "مساعد الصيدلية",
        body: "سير عمل منظم للصيدلي: مراجعة الروشتات وتجهيز الشرح لكل مريض.",
        soon: true,
      },
      {
        mascot: "clover",
        tone: "indigo",
        title: "الأشعة والتحاليل (تعليمي)",
        body: "قراءة تعليمية مبسّطة لتقارير التحاليل والأشعة، ولا تغني عن الطبيب.",
        soon: true,
      },
    ] satisfies LandingSkill[],
  },

  precision: {
    id: "precision",
    eyebrow: "السرعة والدقة معًا",
    title: "تقرأ بسرعة، وتتحقق قبل أن تعرض",
    lead: "في ثوانٍ تمر كل روشتة بأربع مراحل تحقق. وما لا تتأكد منه وصفة AI تضعه أمامك للمراجعة بدل أن تخمّن.",
    sampleBadge: "مثال توضيحي",
    paperTitle: "الروشتة",
    pipelineTitle: "أربع مراحل تحقق",
    speedBadge: "في ثوانٍ",
    resultTitle: "النتيجة",
    steps: [
      {
        icon: "scan",
        title: "مسح الصورة",
        body: "نحسّن الصورة ونحدد أماكن النص المكتوب بخط اليد أو المطبوع.",
      },
      {
        icon: "read",
        title: "قراءة مرتين",
        body: "قراءتان مستقلتان للنص، وأي اختلاف بينهما يُعلَّم ولا يُتجاهل.",
      },
      {
        icon: "database",
        title: "مطابقة مع قاعدة الأدوية",
        body: "نقارن كل اسم بقاعدة بيانات الأدوية لنتحقق من الاسم والتركيز.",
      },
      {
        icon: "gauge",
        title: "فحص الثقة",
        body: "لكل بند درجة ثقة، وما ينخفض عن الحد نوجّهه إلى مراجعتك.",
      },
    ] satisfies LandingPipelineStep[],
    reviewNote: "البند الثالث غير واضح، فعلّمناه للمراجعة بدل أن نخمّن.",
    guarantee: "نفضّل أن نقول «راجع هذا البند» على أن نخطئ بثقة.",
  },

  how: {
    id: "how-it-works",
    eyebrow: "كيف تعمل",
    title: "كيف تعمل وصفة AI؟",
    lead: "ثلاث خطوات من الصورة إلى نتيجة واضحة بالعربية.",
    steps: [
      {
        title: "ارفع الروشتة",
        body: "صوّر الروشتة بكاميرا هاتفك أو ارفع صورة أو ملف PDF. تُحفظ الملفات في مساحة تخزين خاصة بحسابك.",
      },
      {
        title: "نحلّلها لك",
        body: "يقرأ الذكاء الاصطناعي الخط المكتوب أو المطبوع، ويستخرج اسم كل دواء وجرعته وعدد مرات استخدامه ومدته.",
      },
      {
        title: "راجع النتيجة المنظمة",
        body: "تظهر لك بطاقة مرتبة بالعربية، مع تمييز أي بند غير مؤكد لتراجعه مع الطبيب أو الصيدلي قبل الاعتماد عليه.",
      },
    ] satisfies LandingStep[],
  },

  audiences: {
    id: "audiences",
    eyebrow: "لمن صُمِّمت",
    title: "لكل من يتعامل مع الروشتة",
    lead: "المريض الذي يريد أن يفهم، والصيدلي والطبيب اللذان يريدان الوقت، والمؤسسة التي تريد نظامًا.",
    items: [
      {
        icon: "patient",
        tone: "teal",
        title: "للمرضى وأسرهم",
        body: "افهم أدويتك وجرعاتها بلغتك قبل أن تغادر الصيدلية.",
        points: ["بطاقة واضحة بأسماء الأدوية والجرعات", "اسأل عن أي دواء واحصل على شرح مبسّط"],
        soon: true,
      },
      {
        icon: "pharmacist",
        tone: "navy",
        title: "للصيادلة",
        body: "اقرأ الخط الصعب بسرعة، وابدأ بمراجعة ما يحتاج إلى انتباه.",
        points: ["البنود منخفضة الثقة مميزة لتراجعها أولًا", "شرح جاهز تشاركه مع المريض"],
        soon: true,
      },
      {
        icon: "doctor",
        tone: "indigo",
        title: "للأطباء",
        body: "نسخة منظمة من الروشتات تسهّل مراجعة الأدوية مع المريض.",
        points: ["الأدوية والجرعات في بطاقة واحدة مرتبة", "تساعد ولا تحل محل حكمك الطبي"],
        soon: true,
      },
      {
        icon: "organization",
        tone: "amber",
        title: "للصيدليات والعيادات",
        body: "أنشئ مؤسستك وادعُ فريقك بأدوار وصلاحيات واضحة.",
        points: ["أدوار وصلاحيات لكل عضو في الفريق", "إدارة العمل كله من مكان واحد"],
        soon: false,
      },
    ] satisfies LandingAudience[],
  },

  trust: {
    title: "خصوصيتك قبل أي ميزة",
    lead: "نتعامل مع بيانات حساسة، ولذلك نضع الخصوصية والوضوح قبل أي ميزة.",
    items: [
      {
        icon: "lock",
        title: "تخزين خاص ومشفّر",
        body: "تُحفظ ملفاتك في مساحة تخزين خاصة لا تُفتح إلا برابط مؤقت يخصك، وتُحمى بياناتك الحساسة بالتشفير.",
      },
      {
        icon: "shield",
        title: "أنت المتحكم في بياناتك",
        body: "نجمع أقل قدر لازم من البيانات، ونشرح في سياسة الخصوصية ما نجمعه ولماذا، وتستطيع حذف حسابك في أي وقت.",
      },
      {
        icon: "stethoscope",
        title: "تساعد ولا تشخّص",
        body: "وصفة AI أداة مساعدة، لا تقدّم تشخيصًا ولا تحل محل الطبيب أو الصيدلي. راجع المختص قبل أي قرار علاجي.",
      },
      {
        icon: "languages",
        title: "عربي أولًا",
        body: "واجهة عربية من اليمين إلى اليسار، ومصطلحات طبية مألوفة لك في مصر والخليج.",
      },
    ] satisfies LandingTrustItem[],
    privacyLink: "اقرأ سياسة الخصوصية",
    disclaimerLink: "اقرأ إخلاء المسؤولية الطبية",
  },

  faq: {
    id: "faq",
    eyebrow: "أسئلة شائعة",
    title: "نجيبك قبل أن تسأل",
    lead: "إجابات سريعة عن أكثر ما يسألنا عنه الناس.",
    moreTitle: "لم تجد إجابتك؟",
    moreLink: "تواصل معنا",
    items: [
      {
        question: "ما هي وصفة AI؟",
        answer:
          "وصفة AI مساعد طبي ذكي بالعربية. يقرأ صورة الروشتة ويحوّلها إلى بطاقة منظمة بأسماء الأدوية والجرعات ومرات الاستخدام والتحذيرات، ويجيب عن أسئلتك حول الأدوية بلغة مبسطة.",
      },
      {
        question: "هل تشخّص الحالات أو تحل محل الطبيب؟",
        answer:
          "لا. وصفة AI أداة مساعدة تشرح وتنظّم المعلومات، ولا تقدّم تشخيصًا ولا وصفة علاجية. راجع طبيبك أو صيدلي قبل أي قرار يخص علاجك.",
      },
      {
        question: "ما أنواع الروشتات التي يمكن تحليلها؟",
        answer:
          "الروشتات المكتوبة بخط اليد والمطبوعة، بصورة أو بملف PDF. تؤثر جودة الصورة في الدقة، وعندما لا نكون متأكدين من بند نميّزه لتراجعه بنفسك بدلًا من أن نخمّن.",
      },
      {
        question: "هل بياناتي وصوري آمنة؟",
        answer:
          "نحفظ الملفات في مساحة تخزين خاصة لا تُتاح إلا برابط مؤقت، ونشفّر البيانات الحساسة، ونجمع أقل قدر لازم من البيانات. التفاصيل الكاملة في سياسة الخصوصية.",
      },
      {
        question: "هل الخدمة مجانية؟",
        answer:
          "إنشاء الحساب مجاني. ستتوفر حصة شهرية مجانية من التحليلات عند إتاحة المحلل، وتُعلن الخطط المدفوعة قبل تفعيلها، ولن نسحب منك شيئًا دون موافقتك.",
      },
      {
        question: "متى تبدأ ميزة تحليل الروشتات؟",
        answer:
          "الميزة قيد الإعداد وستُتاح تدريجيًا خلال الفترة القادمة. إن أنشأت حسابك الآن فسيكون جاهزًا ما إن تصبح متاحة.",
      },
      {
        question: "هل تناسب الصيدليات والعيادات؟",
        answer:
          "نعم. يمكنك إنشاء مؤسسة ودعوة فريقك بأدوار وصلاحيات مختلفة، وسنضيف أدوات العمل الجماعي مع تطور المنتج.",
      },
      {
        question: "كيف أحذف حسابي وبياناتي؟",
        answer:
          "من صفحة حسابك يمكنك طلب الحذف في أي وقت. نحتفظ بالبيانات 14 يومًا لتتمكن من التراجع، ثم نُخفي هويتك نهائيًا. التفاصيل في سياسة الخصوصية.",
      },
    ] satisfies FaqItem[],
  },

  cta: {
    title: "ابدأ بفهم روشتتك بثقة",
    body: "أنشئ حسابك المجاني الآن، وكن من أوائل من يجرّبون وصفة AI فور إتاحتها.",
    primary: "احصل على وصول مبكر",
    secondary: "تواصل معنا",
  },

  footer: {
    tagline: "مساعد طبي عربي يقرأ الروشتة بسرعة، ويراجع نفسه بدقة.",
    product: "المنتج",
  },

  notices: {
    accountDeleted:
      "وصلنا طلب حذف حسابك. يمكنك استعادته خلال 14 يومًا بالتواصل مع الدعم، وبعدها تُحذف بياناتك الشخصية نهائيًا.",
  },
};
