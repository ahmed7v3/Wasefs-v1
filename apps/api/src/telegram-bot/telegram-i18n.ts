import type { BotLocale } from "./telegram-types.js";

/*
 * Every string the Telegram bot says. Arabic is the default; the chat's language switch picks the
 * other table. `{name}` placeholders are filled by `tg()`; values are HTML-escaped by the caller
 * when they come from users. Messages are HTML (`parse_mode`), so only <b>, <i>, <code> appear here.
 */
const ar = {
  "welcome.default":
    "أهلاً بك في <b>وصفة</b> 💊\nأقرأ لك الروشتة من صورة، وأشرح لك الأدوية والجرعات بالعربي، وأجاوب على أسئلتك عنها.\n\nأرسل صورة الروشتة أو اختر من القائمة 👇",
  "welcome.unlinked":
    "للبدء اربط حسابك بمشاركة رقمك (الزر بالأسفل). مشاركة الرقم تُستخدم لربط حسابك ولإرسال تحديثات الخدمة والعروض. 🔒",
  "menu.title": "القائمة الرئيسية 👇",
  "btn.analyze": "📷 تحليل روشتة",
  "btn.balance": "💰 رصيدي",
  "btn.last": "🕘 آخر تحليل",
  "btn.history": "📚 سجل التحليلات",
  "btn.new": "🆕 محادثة جديدة",
  "btn.language": "🌐 اللغة",
  "btn.help": "❓ مساعدة",
  "btn.support": "💬 الدعم",
  "btn.share": "📱 مشاركة رقمي للربط",
  "btn.signup": "📝 إنشاء حساب",
  "btn.topup": "🛒 شحن الرصيد",
  "btn.rerun": "🔄 إعادة التحليل",
  "btn.ask": "💬 اسأل عن النتيجة",
  "btn.copy": "📋 نسخ ملخّص",
  "btn.newRx": "📷 روشتة جديدة",
  "btn.full": "🔗 النتيجة كاملة",
  "btn.yes": "✅ نعم",
  "btn.no": "↩️ لا",
  "btn.retry": "🔄 حاول مرة أخرى",
  "btn.english": "English 🇬🇧",
  "btn.arabic": "العربية 🇪🇬",
  "gate.unlinked":
    "هذه الخدمة لأصحاب الحسابات 🔒\nشارك رقمك لنربط حسابك في وصفة (الزر بالأسفل)، أو أنشئ حساباً جديداً ثم ارجع.",
  "link.ask":
    "اضغط الزر بالأسفل لمشاركة رقمك. يجب أن يكون الرقم المسجّل والمُوثّق في حسابك على وصفة. 📱",
  "link.success": "تم ربط حسابك بنجاح ✅\nأهلاً <b>{name}</b>! أرسل صورة الروشتة لنبدأ.",
  "link.notOwn": "لازم تشارك رقمك أنت بالزر المخصص، لا جهة اتصال لشخص آخر. ⚠️",
  "link.private": "الربط يتم في المحادثة الخاصة مع البوت فقط. 🔒",
  "link.invalid": "تعذّر قراءة الرقم. حاول مرة أخرى بالزر بالأسفل.",
  "link.noAccount":
    "لا يوجد حساب في وصفة برقم موثّق مطابق لهذا الرقم 🤔\nأنشئ حساباً ووثّق رقمك ثم ارجع واضغط /link.",
  "link.already": "حسابك مربوط بالفعل ✅",
  "unlink.confirm": "هل تريد فصل حسابك عن هذه المحادثة؟",
  "unlink.done": "تم فصل الحساب. يمكنك الربط مجدداً بـ /link.",
  "unlink.none": "لا يوجد حساب مربوط بهذه المحادثة.",
  "balance.text":
    "💰 <b>رصيدك:</b> {balance} رصيد\n💊 <b>سعر التحليل:</b> {price} رصيد للصفحة\n📊 <b>تحليلات متبقية:</b> ≈ {left}",
  "history.title": "📚 <b>آخر تحليلاتك</b>\nاضغط على أي تحليل لفتحه:",
  "history.empty": "لا توجد تحليلات بعد. أرسل صورة روشتة لتبدأ 📷",
  "history.item": "{date} · {count} دواء",
  "last.none": "لا توجد تحليلات سابقة بعد. أرسل صورة روشتة 📷",
  "rx.notFound": "لم أجد هذا التحليل. 🤷",
  "rx.pending": "هذا التحليل ما زال قيد المعالجة ⏳ افتحه بعد قليل من 🕘 آخر تحليل.",
  "rx.failedOld": "هذا التحليل لم يكتمل (وتمت إعادة الرصيد إن كان قد خُصم).",
  "lang.pick": "اختر اللغة / Choose language:",
  "lang.changed": "تم تغيير اللغة إلى العربية ✅",
  "new.done": "بدأنا محادثة جديدة 🆕\nأرسل صورة روشتة جديدة أو اختر من القائمة.",
  "help.text":
    "❓ <b>كيف أستخدم البوت؟</b>\n\n1️⃣ أرسل صورة واضحة للروشتة (أو عدة صور معاً).\n2️⃣ انتظر ثوانٍ وأنا أقرأها وأطابق الأدوية.\n3️⃣ اسألني عن أي دواء أو جرعة في النتيجة.\n\n<b>الأوامر:</b>\n/start الرئيسية · /menu القائمة\n/new محادثة جديدة · /last آخر تحليل\n/history السجل · /balance رصيدي\n/language اللغة · /link ربط · /unlink فصل\n/support الدعم · /ads_on إظهار الإعلانات من جديد\n\n⚠️ المعلومات مساعدة فقط ولا تغني عن الطبيب أو الصيدلي.",
  "support.text": "💬 للدعم والمساعدة تواصل معنا:",
  "support.none": "💬 للدعم راسلنا من خلال موقع وصفة.",
  "photo.hint": "أرسل صورة الروشتة كصورة عادية (أو ملف صورة) وسأقرأها لك 📷",
  "photo.tooBig": "حجم الصورة أكبر من الحد المسموح (10 ميجا). أرسل صورة أصغر. 📏",
  "photo.unsupported": "هذا النوع من الملفات غير مدعوم. أرسل صورة JPG أو PNG أو WebP. 🖼️",
  "stage.received": "📥 استلمت الصورة…",
  "stage.reading": "🔍 أقرأ الروشتة…",
  "stage.matching": "💊 أطابق الأدوية…",
  "stage.done": "✅ جاهز!",
  "rx.empty": "لم أستطع قراءة أدوية من هذه الصورة 😕 جرّب صورة أوضح وبإضاءة جيدة.",
  "rx.header": "💊 <b>نتيجة تحليل الروشتة</b> ({count} دواء)",
  "rx.date": "📅 التاريخ: {date}",
  "rx.dose": "الجرعة",
  "rx.frequency": "التكرار",
  "rx.duration": "المدة",
  "rx.notes": "ملاحظات",
  "rx.purpose": "يُستخدم عادةً لـ",
  "rx.likely": "(مرجّح)",
  "rx.low": "⚠️ قراءة غير مؤكدة، راجعها مع الصيدلي",
  "rx.overview": "📝 <b>نظرة عامة:</b> {value}",
  "rx.unreadable": "⚠️ توجد أجزاء في الروشتة لم أستطع قراءتها.",
  "rx.disclaimer":
    "⚕️ قراءة آلية مساعدة وقد تحتوي على أخطاء، ولا تغني عن الطبيب أو الصيدلي. تحقق من كل دواء وجرعة قبل الاستخدام.",
  "rx.summaryTitle": "ملخّص الروشتة",
  "rx.copyHint": "📋 ملخّص جاهز للنسخ (اضغط على النص لنسخه):",
  "rx.insufficient":
    "رصيدك لا يكفي لهذا التحليل 💳\n💊 السعر: <b>{price}</b> رصيد\n💰 رصيدك: <b>{balance}</b> رصيد\nاشحن رصيدك ثم أرسل الصورة مرة أخرى.",
  "rx.quota": "وصلت للحد المسموح من التحليلات في خطتك اليوم 📊 جرّب لاحقاً أو رقّ خطتك.",
  "rx.busy": "الخدمة مشغولة الآن ⏳ حاول بعد لحظات.",
  "rx.unavailable": "خدمة التحليل متوقفة مؤقتاً 🛠️ حاول لاحقاً.",
  "rx.tooMany": "عدد الصور أكبر من المسموح في تحليل واحد (الحد {max}). أرسل صوراً أقل. 🖼️",
  "rx.unreadableImage": "تعذّرت معالجة الصورة 😕 أرسل صورة أوضح.",
  "rx.stillProcessing": "الصورة لم تُجهّز بعد ⏳ أعد المحاولة بعد لحظات.",
  "rx.failed": "تعذّر إكمال التحليل 😔 لم يُخصم من رصيدك شيء. حاول مرة أخرى.",
  "rx.timeout":
    "التحليل يستغرق وقتاً أطول من المعتاد ⏳ لا تقلق، يمكنك فتح النتيجة بعد قليل من 🕘 آخر تحليل.",
  "rx.again": "أعدت قراءة الصور… 🔄",
  "rx.rerunGone": "لا يمكن إعادة التحليل لأن الصور لم تعد متاحة. أرسل الصورة من جديد. 📷",
  "ask.prompt": "اكتب سؤالك عن هذه الروشتة وسأجيبك 💬",
  "followup.noRx": "أرسل لي صورة الروشتة أولاً لأقرأها، ثم اسألني عن أي شيء فيها 📷",
  "followup.error": "تعذّر الرد الآن 😔 حاول بعد لحظات.",
  "rate.limited": "رسائل كثيرة في وقت قصير ⏳ انتظر قليلاً ثم أكمل.",
  disabled: "البوت متوقف مؤقتاً للصيانة 🛠️ نعود قريباً.",
  "error.generic": "حدث خطأ غير متوقع 😔 حاول مرة أخرى بعد قليل.",
  unsupported: "أرسل صورة روشتة 📷 أو اختر من القائمة.",
  "chat.private": "البوت يعمل في المحادثات الخاصة فقط.",
} as const;

export type TelegramKey = keyof typeof ar;

const en: Record<TelegramKey, string> = {
  "welcome.default":
    "Welcome to <b>Wasfa</b> 💊\nI read your prescription from a photo, explain the medicines and doses, and answer your questions.\n\nSend a photo of the prescription or pick from the menu 👇",
  "welcome.unlinked":
    "To start, link your account by sharing your phone number (button below). Sharing it is used to link your account and for service and marketing updates. 🔒",
  "menu.title": "Main menu 👇",
  "btn.analyze": "📷 Analyze a prescription",
  "btn.balance": "💰 My balance",
  "btn.last": "🕘 Last analysis",
  "btn.history": "📚 History",
  "btn.new": "🆕 New chat",
  "btn.language": "🌐 Language",
  "btn.help": "❓ Help",
  "btn.support": "💬 Support",
  "btn.share": "📱 Share my number to link",
  "btn.signup": "📝 Create an account",
  "btn.topup": "🛒 Top up credits",
  "btn.rerun": "🔄 Re-analyze",
  "btn.ask": "💬 Ask about the result",
  "btn.copy": "📋 Copy summary",
  "btn.newRx": "📷 New prescription",
  "btn.full": "🔗 Full result",
  "btn.yes": "✅ Yes",
  "btn.no": "↩️ No",
  "btn.retry": "🔄 Try again",
  "btn.english": "English 🇬🇧",
  "btn.arabic": "العربية 🇪🇬",
  "gate.unlinked":
    "This service is for account holders 🔒\nShare your number to link your Wasfa account (button below), or create an account and come back.",
  "link.ask":
    "Tap the button below to share your number. It must be the verified number on your Wasfa account. 📱",
  "link.success":
    "Your account is linked ✅\nWelcome <b>{name}</b>! Send a prescription photo to begin.",
  "link.notOwn":
    "Please share your own number with the dedicated button, not someone else's contact. ⚠️",
  "link.private": "Linking works in the private chat with the bot only. 🔒",
  "link.invalid": "I could not read that number. Please try the button below again.",
  "link.noAccount":
    "No Wasfa account has this number verified 🤔\nCreate an account and verify your number, then come back and tap /link.",
  "link.already": "Your account is already linked ✅",
  "unlink.confirm": "Do you want to unlink your account from this chat?",
  "unlink.done": "Account unlinked. You can link again with /link.",
  "unlink.none": "No account is linked to this chat.",
  "balance.text":
    "💰 <b>Your balance:</b> {balance} credits\n💊 <b>Price per analysis:</b> {price} credits per page\n📊 <b>Analyses left:</b> ≈ {left}",
  "history.title": "📚 <b>Your latest analyses</b>\nTap one to open it:",
  "history.empty": "No analyses yet. Send a prescription photo to start 📷",
  "history.item": "{date} · {count} medicines",
  "last.none": "No analyses yet. Send a prescription photo 📷",
  "rx.notFound": "I could not find that analysis. 🤷",
  "rx.pending": "This analysis is still processing ⏳ Open it in a moment from 🕘 Last analysis.",
  "rx.failedOld": "This analysis did not complete (any charge was returned).",
  "lang.pick": "اختر اللغة / Choose language:",
  "lang.changed": "Language changed to English ✅",
  "new.done": "New chat started 🆕\nSend a new prescription photo or pick from the menu.",
  "help.text":
    "❓ <b>How do I use the bot?</b>\n\n1️⃣ Send a clear photo of the prescription (or several together).\n2️⃣ Wait a few seconds while I read it and match the medicines.\n3️⃣ Ask me about any medicine or dose in the result.\n\n<b>Commands:</b>\n/start home · /menu menu\n/new new chat · /last last analysis\n/history history · /balance balance\n/language language · /link link · /unlink unlink\n/support support · /ads_on show ads again\n\n⚠️ Information is for help only and does not replace a doctor or pharmacist.",
  "support.text": "💬 For support and help, contact us:",
  "support.none": "💬 For support, contact us through the Wasfa website.",
  "photo.hint": "Send the prescription as a normal photo (or an image file) and I will read it 📷",
  "photo.tooBig": "The image is larger than the limit (10 MB). Send a smaller one. 📏",
  "photo.unsupported": "That file type is not supported. Send a JPG, PNG or WebP image. 🖼️",
  "stage.received": "📥 Photo received…",
  "stage.reading": "🔍 Reading the prescription…",
  "stage.matching": "💊 Matching the medicines…",
  "stage.done": "✅ Ready!",
  "rx.empty":
    "I could not read any medicine from this image 😕 Try a clearer photo with good light.",
  "rx.header": "💊 <b>Prescription analysis</b> ({count} medicines)",
  "rx.date": "📅 Date: {date}",
  "rx.dose": "Dose",
  "rx.frequency": "Frequency",
  "rx.duration": "Duration",
  "rx.notes": "Notes",
  "rx.purpose": "Commonly used for",
  "rx.likely": "(likely)",
  "rx.low": "⚠️ Uncertain reading, check with the pharmacist",
  "rx.overview": "📝 <b>Overview:</b> {value}",
  "rx.unreadable": "⚠️ Some parts of the prescription could not be read.",
  "rx.disclaimer":
    "⚕️ An automatic reading that can contain mistakes. It does not replace a doctor or a pharmacist. Check every medicine and dose before use.",
  "rx.summaryTitle": "Prescription summary",
  "rx.copyHint": "📋 A summary you can copy (tap the text to copy):",
  "rx.insufficient":
    "Your balance is not enough for this analysis 💳\n💊 Price: <b>{price}</b> credits\n💰 Your balance: <b>{balance}</b> credits\nTop up, then send the photo again.",
  "rx.quota": "You reached your plan analysis limit for today 📊 Try later or upgrade.",
  "rx.busy": "The service is busy right now ⏳ Try again in a moment.",
  "rx.unavailable": "Analysis is paused for now 🛠️ Try again later.",
  "rx.tooMany": "Too many images for one analysis (limit {max}). Send fewer. 🖼️",
  "rx.unreadableImage": "I could not process the image 😕 Send a clearer one.",
  "rx.stillProcessing": "The image is not ready yet ⏳ Try again in a moment.",
  "rx.failed": "The analysis could not be completed 😔 You were not charged. Please try again.",
  "rx.timeout":
    "The analysis is taking longer than usual ⏳ No worries, open the result in a moment from 🕘 Last analysis.",
  "rx.again": "Re-reading the images… 🔄",
  "rx.rerunGone":
    "I cannot re-run it because the images are no longer available. Send the photo again. 📷",
  "ask.prompt": "Type your question about this prescription and I will answer 💬",
  "followup.noRx":
    "Send me the prescription photo first so I can read it, then ask me anything about it 📷",
  "followup.error": "I could not reply right now 😔 Try again in a moment.",
  "rate.limited": "Too many messages in a short time ⏳ Please wait a bit, then continue.",
  disabled: "The bot is down for maintenance 🛠️ We will be back soon.",
  "error.generic": "Something unexpected happened 😔 Please try again shortly.",
  unsupported: "Send a prescription photo 📷 or pick from the menu.",
  "chat.private": "The bot works in private chats only.",
};

const TABLES: Record<BotLocale, Record<TelegramKey, string>> = { ar, en };

/** The string for `key` in `locale`, with `{name}` placeholders filled. */
export function tg(
  locale: BotLocale,
  key: TelegramKey,
  values: Record<string, string | number> = {},
): string {
  return TABLES[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
