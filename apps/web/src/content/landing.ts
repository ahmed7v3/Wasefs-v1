/*
 * Landing page copy (Arabic). Components render this; they never contain their own text.
 *
 * Voice rules (AGENT.md §5.11 and the product phase): the product assists and never diagnoses; the
 * analyzer is not live yet, so every call to action is "create a free account", never "try it now";
 * no invented numbers, ratings or testimonials.
 */

export type FeatureIcon = "scan" | "sparkles" | "building";
export type TrustIcon = "shield" | "lock" | "stethoscope" | "languages";

export interface LandingStep {
  title: string;
  body: string;
}

export interface LandingFeature {
  icon: FeatureIcon;
  title: string;
  body: string;
  /** Shown as a "coming soon" badge when the capability is not live yet. */
  soon: boolean;
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
    eyebrow: "قريبًا · سجّل الآن لتكون من أوائل المستخدمين",
    title: "افهم روشتتك في ثوانٍ",
    lead: "وصفة AI مساعد عربي يقرأ صورة الروشتة المكتوبة بخط اليد أو المطبوعة، ويحوّلها إلى بطاقة واضحة بأسماء الأدوية والجرعات ومرات الاستخدام والتحذيرات، لتراجعها مع طبيبك أو صيدلي.",
    primaryCta: "أنشئ حسابك المجاني",
    secondaryCta: "كيف تعمل؟",
    reassurance: "إنشاء الحساب مجاني ولا يحتاج إلى بطاقة بنكية.",
    haveAccount: "لديك حساب بالفعل؟",
    signIn: "تسجيل الدخول",
  },

  /** The illustration beside the hero headline: a sample, not a real result. */
  visual: {
    alt: "مثال توضيحي: روشتة مكتوبة بخط اليد تتحول إلى بطاقة نتيجة منظمة بأسماء الأدوية والجرعات.",
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

  how: {
    id: "how-it-works",
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

  features: {
    id: "features",
    title: "ما الذي تقدمه لك؟",
    lead: "أدوات مصممة للمرضى والصيادلة والأطباء والمؤسسات الصحية.",
    items: [
      {
        icon: "scan",
        title: "تحليل الروشتات",
        body: "من صورة الروشتة إلى بيانات مرتبة: أسماء الأدوية والجرعات والمدة والتنبيهات. تُميَّز البنود منخفضة الثقة لتراجعها بنفسك.",
        soon: true,
      },
      {
        icon: "sparkles",
        title: "مساعد ذكي بمهارات متخصصة",
        body: "اسأل بالعربية عن دواء أو تحليل واحصل على شرح مبسّط. تُضاف المهارات تباعًا، مثل معلومات الأدوية وقراءة تعليمية للتحاليل والأشعة.",
        soon: true,
      },
      {
        icon: "building",
        title: "للصيدليات والعيادات",
        body: "أنشئ مؤسستك وادعُ فريقك بأدوار وصلاحيات واضحة، وأدر العمل كله من مكان واحد.",
        soon: false,
      },
    ] satisfies LandingFeature[],
  },

  trust: {
    title: "تصميمنا يبدأ من ثقتك",
    lead: "نتعامل مع بيانات حساسة، ولذلك نضع الخصوصية والوضوح قبل أي ميزة.",
    items: [
      {
        icon: "shield",
        title: "خصوصيتك أولًا",
        body: "نجمع أقل قدر من البيانات اللازمة لتشغيل الخدمة، ونشرح في سياسة الخصوصية ما نجمعه ولماذا ومدة الاحتفاظ به.",
      },
      {
        icon: "lock",
        title: "تخزين خاص ومشفّر",
        body: "تُحفظ ملفاتك في مساحة تخزين خاصة لا تُفتح إلا برابط مؤقت يخصك، وتُحمى بياناتك الحساسة بالتشفير.",
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
    title: "أسئلة شائعة",
    lead: "إجابات سريعة عن أكثر ما يسألنا عنه الناس.",
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
    primary: "أنشئ حسابك المجاني",
    secondary: "تواصل معنا",
  },

  notices: {
    accountDeleted:
      "وصلنا طلب حذف حسابك. يمكنك استعادته خلال 14 يومًا بالتواصل مع الدعم، وبعدها تُحذف بياناتك الشخصية نهائيًا.",
  },
};
