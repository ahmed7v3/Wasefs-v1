/*
 * Landing page copy (Arabic). Components render this; they never contain their own text.
 *
 * Voice rules (AGENT.md §5.11 and the product phase): the product assists and never diagnoses; the
 * web app is live (prescription analysis, the assistant skills, organizations), so calls to action
 * say "create a free account" and a feature is marked "coming soon" only when its route does not
 * ship; the Android and iOS apps are the one thing still "coming soon"; no invented numbers,
 * ratings, testimonials or certifications. "In seconds" is the product goal, not a measured figure,
 * so it carries no number.
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

/** A dose time of a schedule chip; `kind` picks the sun (day) or moon (night) icon. */
export interface SceneTime {
  label: string;
  kind: "sun" | "moon";
}

export interface SceneItem {
  name: string;
  dose: string;
  times: SceneTime[];
}

export type WhatsappTileIcon = "photo" | "voice" | "medicine" | "files" | "pay" | "account";

export interface WhatsappTile {
  icon: WhatsappTileIcon;
  title: string;
  body: string;
}

/** One message of the scripted WhatsApp conversation; `meds` renders the sample medicine card. */
export interface ChatMessage {
  from: "user" | "agent";
  kind: "photo" | "text" | "voice" | "meds" | "file";
  text: string;
}

export interface WayItem {
  key: "whatsapp" | "web" | "native";
  title: string;
  body: string;
  status: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export const landing = {
  hero: {
    pill: "مساعد عربي ذكي على الموقع وعلى واتساب",
    titleLines: ["روشتتك مفهومة في ثوانٍ…", "حتى من واتساب"],
    lead: "صوّر أي روشتة، حتى المكتوبة بخط اليد، واعرف كل دواء وجرعته ومواعيده. ثم تحدّث مع مساعد ذكي على الموقع أو من واتساب. وصفة تساعدك على الفهم ولا تحل محل الطبيب أو الصيدلي.",
    primaryCta: "ابدأ مجانًا",
    whatsappCta: "كلّم وصفة على واتساب",
    whatsappGreeting: "مرحبًا وصفة",
    chips: ["بدون تثبيت تطبيق", "عربي 100%", "خصوصيتك محمية"],
    haveAccount: "لديك حساب بالفعل؟",
    signIn: "تسجيل الدخول",
  },

  /** The hero illustration: a WhatsApp-style chat with the assistant. A sample, not a real result. */
  scene: {
    alt: "رسم توضيحي (مثال): هاتف يعرض محادثة على واتساب، أرسل فيها المستخدم صورة روشتة فردّ المساعد ببطاقة دواءين لكل منهما الجرعة ومواعيد الاستخدام، ثم ملف PDF ورسالة صوتية. بجانبه ورقة روشتة بخط اليد.",
    sampleBadge: "مثال توضيحي",
    agentName: "وصفة",
    agentStatus: "مساعد ذكي",
    photoCaption: "صورة الروشتة",
    reply: "قرأت روشتتك. هذه أدويتك ومواعيدها:",
    items: [
      {
        name: "أموكسيسيلين 500 مجم",
        dose: "كبسولة بعد الأكل · 7 أيام",
        times: [
          { label: "8 ص", kind: "sun" },
          { label: "2 م", kind: "sun" },
          { label: "8 م", kind: "moon" },
        ],
      },
      {
        name: "باراسيتامول 500 مجم",
        dose: "قرص عند اللزوم · 3 أيام",
        times: [
          { label: "8 ص", kind: "sun" },
          { label: "8 م", kind: "moon" },
        ],
      },
    ] satisfies SceneItem[],
    pdfName: "تقرير الروشتة.pdf",
    pdfMeta: "PDF · جاهز للمشاركة",
    voiceLabel: "رسالة صوتية",
    voiceLength: "0:12",
  },

  whatsapp: {
    id: "whatsapp",
    eyebrow: "واتساب",
    title: "كل حاجة من واتساب… مع مساعد ذكي جدًا",
    lead: "لا تطبيق تثبّته ولا قوائم تتوه فيها. أرسل رسالة، ووصفة يفهمك ويرد عليك.",
    tilesLabel: "ما يمكنك فعله من واتساب",
    tiles: [
      {
        icon: "photo",
        title: "أرسل صورة الروشتة",
        body: "يقرأها كاملة ويعيد لك الأدوية والجرعات والمواعيد في رسالة واحدة.",
      },
      {
        icon: "voice",
        title: "تحدّث بصوتك",
        body: "أرسل رسالة صوتية فيسمعها ويرد عليك برسالة صوتية أيضًا.",
      },
      {
        icon: "medicine",
        title: "اسأل عن أي دواء",
        body: "السعر والبدائل الأرخص بنفس المادة الفعالة، من قاعدة تضم أكثر من 27 ألف دواء مصري.",
      },
      {
        icon: "files",
        title: "استلم ملفاتك",
        body: "تقرير PDF وبطاقة مواعيد الدواء، تحفظها وتشاركها مع من تريد.",
      },
      {
        icon: "pay",
        title: "اشترك وادفع من المحادثة",
        body: "اختر الباقة وأكمل الدفع من المحادثة نفسها.",
      },
      {
        icon: "account",
        title: "أنشئ حسابك برسالة واحدة",
        body: "ابدأ المحادثة ويجهّز لك المساعد حسابك في خطوة واحدة.",
      },
    ] satisfies WhatsappTile[],
    phoneLabel:
      "مثال لمحادثة على واتساب: تُرسل صورة روشتة فيقرأها المساعد ويرد ببطاقة الأدوية ومواعيدها، ثم رسالة صوتية، وسؤال عن بديل أرخص، وملف PDF.",
    chat: [
      { from: "user", kind: "photo", text: "صورة الروشتة" },
      { from: "agent", kind: "text", text: "وصلت الروشتة، أقرؤها الآن." },
      { from: "agent", kind: "meds", text: "تمت القراءة. هذه أدويتك ومواعيدها:" },
      { from: "user", kind: "voice", text: "0:07" },
      { from: "agent", kind: "voice", text: "0:09" },
      { from: "user", kind: "text", text: "هل يوجد بديل أرخص للدواء الأول؟" },
      {
        from: "agent",
        kind: "text",
        text: "نعم، بدائل بنفس المادة الفعالة. أعرضها لك مع أسعارها لتراجع الصيدلي.",
      },
      { from: "agent", kind: "file", text: "تقرير الروشتة.pdf" },
    ] satisfies ChatMessage[],
    cta: "ابدأ المحادثة على واتساب",
    qrTitle: "أو امسح الكود بهاتفك",
    qrLabel: "رمز QR لفتح المحادثة مع وصفة على واتساب",
    note: "وصفة تشرح وتنظّم ولا تشخّص. راجع طبيبك أو الصيدلي قبل أي قرار علاجي.",
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
        soon: false,
      },
      {
        mascot: "hexagon",
        tone: "coral",
        title: "التداخلات الدوائية",
        body: "تنبّهك إلى الأدوية التي قد يتعارض بعضها مع بعض لتسأل عنها الصيدلي.",
        soon: false,
      },
      {
        mascot: "droplet",
        tone: "teal",
        title: "الجرعات والتعليمات",
        body: "الجرعة وعدد المرات والمدة وتعليمات الاستخدام في سطر واحد واضح.",
        soon: false,
      },
      {
        mascot: "tablet",
        tone: "amber",
        title: "شرح الدواء للمريض",
        body: "اسأل بالعربية عن أي دواء واحصل على شرح مبسّط بلغة قريبة منك.",
        soon: false,
      },
      {
        mascot: "blob",
        tone: "olive",
        title: "مساعد الصيدلية",
        body: "ابدأ بالبنود التي تحتاج مراجعة، ثم انسخ الشرح أو شاركه أو اطبعه للمريض.",
        soon: false,
      },
      {
        mascot: "clover",
        tone: "indigo",
        title: "الأشعة والتحاليل (تعليمي)",
        body: "قراءة تعليمية مبسّطة لتقارير التحاليل والأشعة، ولا تغني عن الطبيب.",
        soon: false,
      },
    ] satisfies LandingSkill[],
  },

  precision: {
    id: "precision",
    eyebrow: "خطوة بخطوة",
    title: "رحلة كل سطر في روشتتك",
    lead: "نتتبع سطرًا واحدًا من الخط المكتوب إلى نتيجة موثوقة. وما لا نتأكد منه نعلّمه بدل أن نخمّن.",
    stepsLabel: "أربع مراحل لكل سطر",
    sampleBadge: "مثال توضيحي",
    steps: [
      {
        title: "قراءة الخط",
        body: "نقرأ السطر المكتوب بخط اليد كما هو، حرفًا بحرف، قبل أي تفسير.",
      },
      {
        title: "مطابقة دقيقة",
        body: "نقارن الاسم المقروء بقاعدة الأدوية ونختار الأقرب مع مادته الفعالة.",
      },
      {
        title: "فحص الأمان",
        body: "نراجع الجرعة والتركيز، وننبّه إذا تكررت المادة الفعالة بين دوائين.",
      },
      {
        title: "نتيجة واضحة",
        body: "بطاقة مرتبة بالدواء ومواعيده. وأي سطر غير مؤكد يبقى مُعلَّمًا لتراجعه.",
      },
    ] satisfies LandingStep[],
    sample: {
      scribble: "Amoxil 500 1×3",
      readLabel: "ما قرأناه",
      candidatesLabel: "أقرب الأسماء في قاعدة الأدوية",
      candidates: ["Amoxil", "Amaryl", "Amoxapine"],
      confidence: "ثقة عالية",
      ingredientLabel: "المادة الفعالة",
      ingredient: "أموكسيسيلين",
      doseLabel: "الجرعة",
      dose: "500 mg · 3 مرات يوميًا",
      doseOk: "ضمن المعتاد",
      duplicateBadge: "مادة فعالة مكررة",
      duplicateNote: "باراسيتامول موجود في دوائين من الروشتة.",
      resultName: "أموكسيسيلين 500 مجم",
      resultDetail: "3 مرات يوميًا · 7 أيام",
      resultTimes: [
        { label: "8 ص", kind: "sun" },
        { label: "2 م", kind: "sun" },
        { label: "8 م", kind: "moon" },
      ] satisfies SceneTime[],
    },
    proof: {
      avgLabel: "متوسط وقت التحليل",
      avgUnit: "ثانية",
      accuracyLabel: "دقة قراءة الحقول في اختبارات التقييم",
      note: "أرقام من اختبارات داخلية، وتتغير مع تحسين النظام.",
    },
    link: "اعرف أكثر عن قارئ الروشتات",
  },

  how: {
    id: "how-it-works",
    eyebrow: "كيف تعمل",
    title: "كيف تعمل وصفة AI؟",
    lead: "ثلاث خطوات من الصورة إلى نتيجة واضحة بالعربية.",
    whatsappNote: "أو أرسلها مباشرة على واتساب وسيرد عليك المساعد.",
    whatsappLink: "افتح المحادثة",
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
        soon: false,
      },
      {
        icon: "pharmacist",
        tone: "navy",
        title: "للصيادلة",
        body: "اقرأ الخط الصعب بسرعة، وابدأ بمراجعة ما يحتاج إلى انتباه.",
        points: ["البنود منخفضة الثقة مميزة لتراجعها أولًا", "شرح تنسخه أو تشاركه أو تطبعه للمريض"],
        soon: false,
      },
      {
        icon: "doctor",
        tone: "indigo",
        title: "للأطباء",
        body: "نسخة منظمة من الروشتات تسهّل مراجعة الأدوية مع المريض.",
        points: ["الأدوية والجرعات في بطاقة واحدة مرتبة", "تساعد ولا تحل محل حكمك الطبي"],
        soon: false,
      },
      {
        icon: "organization",
        tone: "amber",
        title: "للصيدليات والعيادات",
        body: "أنشئ مؤسستك وادعُ فريقك بأدوار وصلاحيات واضحة، وتابع استخدامه من لوحة واحدة.",
        points: ["أدوار وصلاحيات لكل عضو في الفريق", "لوحة واحدة للأعضاء والاستخدام"],
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
    /** One answer open at a time (the `name` attribute groups the `<details>`); `false` lets several stay open. */
    exclusive: true,
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
          "إنشاء الحساب مجاني ويتضمن حصة شهرية مجانية من تحليلات الروشتات. وإن احتجت أكثر فتجد الباقات المدفوعة وأسعارها في صفحة الأسعار، ولن نسحب منك شيئًا دون موافقتك.",
      },
      {
        question: "كيف أبدأ بتحليل روشتتي؟",
        answer:
          "أنشئ حسابك المجاني، ثم ارفع صورة الروشتة أو ملف PDF من صفحة التحليل، وستظهر لك النتيجة المنظمة خلال لحظات لتراجعها.",
      },
      {
        question: "هل تناسب الصيدليات والعيادات؟",
        answer:
          "نعم. يمكنك إنشاء مؤسسة ودعوة فريقك بأدوار وصلاحيات مختلفة، ومتابعة الأعضاء والاستخدام من لوحة المؤسسة.",
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
    body: "أنشئ حسابك المجاني الآن، أو أرسل أول روشتة من واتساب واسأل عن أي دواء بالعربية.",
    primary: "ابدأ مجانًا",
    whatsapp: "كلّم وصفة على واتساب",
    secondary: "تواصل معنا",
  },

  /** "Wasfa in your pocket": the ways to use the product today and what is still coming. */
  apps: {
    title: "وصفة في جيبك",
    lead: "تعمل وصفة الآن على أي هاتف، من المتصفح أو من واتساب. وتطبيقا أندرويد و iOS قادمان قريبًا.",
    phoneLabel:
      "رسم توضيحي لشاشة هاتف تعرض نتيجة تحليل روشتة ببطاقتي دواء ومواعيدهما (مثال توضيحي)",
    resultTitle: "النتيجة المنظمة",
    resultMeta: "دواءان",
    resultNote: "وصفة تساعد ولا تشخّص",
    sampleBadge: "مثال توضيحي",
    waysLabel: "طرق استخدام وصفة",
    ways: [
      {
        key: "whatsapp",
        title: "واتساب",
        body: "أرسل الروشتة واسأل المساعد دون تثبيت أي شيء.",
        status: "متاح الآن",
      },
      {
        key: "web",
        title: "تطبيق الويب",
        body: "افتح الموقع من المتصفح وثبّته على الشاشة الرئيسية لهاتفك.",
        status: "متاح الآن",
      },
      {
        key: "native",
        title: "تطبيقات الهاتف",
        body: "نعمل على تطبيقين مخصصين لأندرويد و iOS.",
        status: "قريبًا",
      },
    ] satisfies WayItem[],
    soon: "قريبًا",
    android: "أندرويد",
    ios: "iOS",
    googlePlay: "Google Play",
    appStore: "App Store",
    waitlist: {
      title: "أبلغني عند الإطلاق",
      lead: "اترك بريدك وسنراسلك مرة واحدة عند توفر التطبيق.",
      email: "البريد الإلكتروني",
      platform: "المنصة",
      platforms: { android: "أندرويد", ios: "iOS", both: "أندرويد و iOS" },
      consent: "أوافق على أن تراسلني وصفة AI بالبريد عند إطلاق التطبيق.",
      consentRequired: "للمتابعة وافق على استلام رسالة الإطلاق.",
      submit: "أبلغني عند الإطلاق",
      successTitle: "تم تسجيلك",
      successBody: "سنراسلك عند إطلاق التطبيق. يمكنك إلغاء الاشتراك من الرسالة نفسها.",
      disabled: "التسجيل في قائمة الانتظار غير متاح الآن.",
    },
  },

  footer: {
    tagline: "مساعد طبي عربي يقرأ الروشتة بسرعة، ويراجع نفسه بدقة.",
    appsSoon: "التطبيقات قريبًا",
    columnsLabel: "روابط الموقع",
    product: "المنتج",
    company: "الشركة",
    legal: "قانوني",
    links: {
      prescriptionReader: "قارئ الروشتات",
      handwrittenPrescriptions: "الروشتات المكتوبة بخط اليد",
      medicineExplainer: "شرح الأدوية",
      aiAssistant: "المساعد الذكي",
      pricing: "الأسعار",
      pharmacists: "للصيادلة",
      clinics: "للعيادات",
      about: "عن وصفة AI",
      editorialPolicy: "السياسة التحريرية",
      medicalReview: "المراجعة الطبية",
      sources: "المصادر",
      contact: "تواصل معنا",
      privacy: "سياسة الخصوصية",
      terms: "شروط الاستخدام",
      disclaimer: "إخلاء المسؤولية الطبية",
    },
  },

  notices: {
    accountDeleted:
      "وصلنا طلب حذف حسابك. يمكنك استعادته خلال 14 يومًا بالتواصل مع الدعم، وبعدها تُحذف بياناتك الشخصية نهائيًا.",
  },
};
