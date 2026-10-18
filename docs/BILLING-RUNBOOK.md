# BILLING-RUNBOOK.md — Running billing day to day

For the owner and finance admins. No coding needed. Arabic text in quotes is exactly what you see on screen (the admin is Arabic-first). If a step says **(not in the console yet)**, the feature is not built and you cannot do it from the screen.

Design background lives in `BILLING.md`; the screens in `ADMIN-CONSOLE-SPEC.md`. This file says what to click and what to do when something looks wrong.

## 0. Before you start

**Where things are.** In the admin side menu, group "الإيرادات" (Revenue) and group "التسعير" (Pricing):

| Menu label | Path | Use it for |
|---|---|---|
| "نظرة على الإيرادات" | `/admin/billing` | Daily check, numbers |
| "المدفوعات" | `/admin/billing/payments` | All payments and the review queue |
| "الاشتراكات" | `/admin/billing/subscriptions` | Who subscribes, extend, end |
| "الطلبات والفواتير" | `/admin/billing/orders` | Orders, receipts, resend receipt |
| "الاستردادات" | `/admin/billing/refunds` | List of recorded refunds |
| "الباقات والأسعار" | `/admin/billing/plans` | Prices (draft, publish) |
| "العروض" | `/admin/billing/promotions` | Promotions |
| "الكوبونات" | `/admin/billing/coupons` | Coupons and batches |
| "باقات الرصيد" | `/admin/billing/credit-packs` | Credit packs |
| "طرق الدفع والرسوم" | `/admin/billing/methods` | Methods, account numbers, fees, tax |
| "بوابة الدفع" | `/admin/billing/gateways` | Kashier keys and verification |

**Quick search.** Press Ctrl+K anywhere in the admin ("بحث في لوحة الإدارة") and type a phone, email, order number `WSO-...`, payment reference `WSP-...` or a coupon code (at least 2-3 characters; the box tells you).

**Fresh sign-in.** Money actions (approve, reject, refund, publish prices, change account number, gateway keys) ask you to confirm your password again if you last signed in more than about 10 minutes ago. This is normal; a prompt appears, then the action continues.

**What you can see depends on your role.** Without the right permission a button is missing or the page says you only have read access (for example "لا تملك صلاحية تغيير رقم الحساب"). Ask the owner to give you the permission.

**Money.** Amounts are shown in the customer's currency. Wasfa never stores card data. Credits only change through the credit ledger.

---

## 1. Daily check (5 minutes)

**When:** once in the morning, and once in the evening if you review manual payments.

1. Open "نظرة على الإيرادات" (`/admin/billing`).
2. Read the panel "يحتاج انتباهك" (Needs your attention). Each line is a counter with a link:
   - "تحويلات بانتظار المراجعة" (manual transfers waiting) with "أقدمها منذ ..." (the oldest waiting) and "تجاوز المهلة" (overdue). Click "افتح الطابور" to start reviewing (section 2).
   - "مدفوعات فشلت أو لم يتطابق مبلغها (آخر 24 ساعة)" (failed or amount mismatch, last 24 h). Click "افتح القائمة" and open each one (section 8).
   - "طلبات سحب بانتظار المراجعة" (withdrawals) and "مكافآت معلّقة للمراجعة" (held rewards): see section 11; withdrawals are not handled in this runbook yet.
   - "اشتراكات كبيرة تنتهي خلال 3 أيام" (big subscriptions ending in 3 days): optional; consider contacting the customer.
   - "عروض تنتهي خلال 48 ساعة وكوبونات قاربت النفاد" (promotions ending, coupons nearly used up).
3. If it says "لا شيء ينتظر" (nothing waiting), you are done.
4. Glance at the numbers: choose the period with "الفترة" ("اليوم", "7 أيام", "30 يومًا", "فترة مخصصة"). Look for a sudden drop in "الإيراد (قبل الضريبة)" or a jump in "نسبة الاسترداد" (refund rate).
5. Check your alerts (Telegram or email, section 10). Alerts marked critical must be looked at the same day.

**What can go wrong**

| You see | Do |
|---|---|
| The numbers page does not load | Press "تحديث" (refresh). If it still fails, see the logs (section 9, "Looking at the logs"). |
| Overdue transfers pile up | Review them now (section 2). Customers are waiting for access. |
| Many payments failed in 24 h | Check whether the gateway is healthy (section 9) and read the failure-spike alert (section 10). |

---

## 2. Approve or reject a manual payment (InstaPay / Vodafone Cash)

**When:** a customer paid by transfer to our InstaPay address or Vodafone Cash wallet and uploaded a proof. The payment appears in the queue as "بانتظار المراجعة".

**Important rules the system enforces**

- You can never review a payment from your own account or organization.
- Above the four-eyes limit (setting `billing.fourEyesThresholdMinor`, in minor units, EGP payments), two different admins are needed: the first approval only sends it to the second ("إرسال للموافقة الثانية"), another admin completes it ("تأكيد الموافقة الثانية").
- Approving or rejecting asks for a fresh sign-in.
- An open payment is marked "قيد المراجعة بواسطة <name>" for 5 minutes so two admins do not work on the same one. This lock is advice only; you can take over.

**Steps**

1. Go to "المدفوعات" and choose the view "طابور المراجعة" (or click "افتح الطابور" from the overview). The queue shows overdue payments first, then the oldest.
2. Click a row. After a moment the payment is claimed for you. On the right you see the pane "مراجعة الدفعة":
   - the proof image (buttons "تكبير", "تصغير", "تدوير", "فتح بالحجم الكامل");
   - "قائمة التحقق" (checklist): "المبلغ المطلوب", "المرجع" (the `WSP-` reference), "طريقة الدفع", "رقم المحوِّل", "رقم العملية". Each row has a copy button and a "مطابق؟" box. The box is a memory aid only and is not saved.
   - a red "تحذيرات" box if the system found problems.
3. **Verify in the wallet app itself, not only in the screenshot** (screenshots can be faked):
   1. Open the InstaPay or Vodafone Cash app on the receiving account.
   2. Find the incoming transfer using the transaction number ("رقم العملية") or the amount and time.
   3. Check that the amount equals "المبلغ المطلوب" exactly, the sender matches "رقم المحوِّل" where the app shows it, and the money is really in the balance (not "pending").
   4. If the transfer note shows the `WSP-` reference, it should equal "المرجع".
4. Read every item in "تحذيرات":

   | Warning (Arabic) | Meaning | What to do |
   |---|---|---|
   | "صورة الإثبات مطابقة تمامًا لإثبات الطلب ..." | Same image as another order's proof | Almost certainly reuse. Check the other order; reject with "إثبات مكرر" unless the wallet really shows this transfer. |
   | "صورة الإثبات تشبه إثبات الطلب ..." | Very similar image | Same as above, but take more care (could be a screenshot of the same screen from a legitimate second transfer). |
   | "رقم العملية مكرر." | Transaction number already used | Reject unless the wallet shows a separate transfer. |
   | "المبلغ المكتوب يختلف عن المطلوب." | Customer typed another amount | Compare with the wallet. Wrong amount: reject with "المبلغ مختلف" (section below). |
   | "عمر الحساب أقل من يوم." | Account under one day old | Be extra strict in the wallet check. |
   | "سُجّل ... إثبات مرفوض سابقًا لهذا العميل." | Earlier rejected proofs | Be strict. |

   Duplicate-image flags make the alert critical but do not block you.
5. Decide.

**Approve ("اعتماد")**

1. Click "اعتماد". Dialog "اعتماد الدفعة" says what will start and for how much.
2. Click "اعتماد وتفعيل". If prompted, enter your password.
3. You see "اعتُمدت الدفعة وفُعّل الاشتراك". The customer gets a notification, a receipt and (if enabled) a WhatsApp message. The queue moves to the next payment.
4. If the amount is above the limit the button says "إرسال للموافقة الثانية" and you see "أُرسلت للموافقة الثانية". The payment shows the badge "موافقة ثانية". A different admin opens it, sees "اعتمدها مراجع أول. أكّد الاعتماد إن كانت البيانات صحيحة." and clicks "تأكيد الموافقة الثانية".

**Reject ("رفض")**

1. Click "رفض". Choose "سبب الرفض":
   "المبلغ مختلف", "لم يصل التحويل", "الإثبات غير واضح", "إثبات مكرر", "المرجع غير صحيح" or "سبب آخر".
2. A note is required for "سبب آخر" and "المبلغ مختلف". The customer sees the reason and the note.
3. Click "تأكيد الرفض". You see "رُفضت الدفعة".
4. The customer may send one more proof after a rejection.
5. **Wrong amount:** the system does not approve a smaller period. Reject with "المبلغ مختلف" and write what is missing in the note; the customer pays the difference as a new order.

**Ask for a clearer proof ("اطلب إثباتًا أوضح")**

Use it when the image is blurry or cropped but the payment may be real. Click it, optionally write a note, click "إرسال الطلب". The payment stays open, the customer is told to upload a new proof. A customer can submit at most 3 proofs per payment.

**Keyboard shortcuts** (when the pane is open and no dialog is open): `J` next, `K` previous, `A` approve, `R` reject, `C` clearer proof, `S` skip (go to the next). They are shown under the queue ("اختصارات:").

**What can go wrong**

| Problem | Do |
|---|---|
| "يراجعها الآن <name>" and the buttons are disabled | Another admin has it. Skip, or click "تولّي المراجعة" and confirm only if you are sure they are away. |
| "تعذّر عرض الإثبات الآن" (proof not available) | Reload later. You may still decide from the wallet and the data beside it. |
| Cannot approve: it is your own payment | Ask another admin. |
| Two admins approved at the same time | Only one activation happens. No action needed. |
| Customer says "I sent it" but the wallet shows nothing | Reject with "لم يصل التحويل". Transfers can take time; consider "اطلب إثباتًا أوضح" first. |
| Review is late | Reminders arrive every 30 minutes during working hours (Cairo 09:00-22:00 by default). |

---

## 3. Issue and record a refund

**Wasfa does not send money back.** You refund outside Wasfa, then record it here so access, credits and reports stay correct.

**When:** the customer is owed money back (duplicate payment, mistake, within your refund policy; `billing.refundWindowDays` is a setting).

**Before recording**

1. Refund the money first:
   - **Card (Kashier):** in the Kashier dashboard, open the transaction and issue a full or partial refund. Copy its refund reference.
   - **InstaPay / Vodafone Cash:** send the money back by transfer from the receiving wallet. Copy the transfer number.
2. Keep that reference number. Wasfa asks for it.

**Steps (needs the refund permission and fresh sign-in)**

1. Go to "المدفوعات", find the payment (search by `WSO-` order number), open it.
2. Click "استرداد". The dialog "استرداد دفعة الطلب <number>" opens.
3. "المبلغ المسترد": leave the default for a **full refund**, or type a smaller amount for a **partial refund**. The hint "الحد الأقصى القابل للاسترداد" shows the limit.
4. Read "ماذا سيحدث" (what will happen). It is calculated before you confirm:
   - full refund: "استرداد كامل: يُغلق الطلب كمسترد";
   - partial: "استرداد جزئي: يبقى ... قابلًا للاسترداد بعده";
   - the subscription effect line (see table below);
   - "الرصيد الممنوح ...، المستخدم منه ..." (credits granted and already used);
   - referral rewards that will be reversed ("مكافآت إحالة تُعكس"); a used coupon stays used ("الكوبون المستخدم يبقى مستهلكًا").
5. "رصيد يُسحب من العميل" (credits to take back): choose how many unused credits to remove. It cannot exceed the unused credits, so a customer never goes below zero.
6. "مرجع التحويل الخارجي": paste the refund reference from step 1 (the box says it is the number of the transfer you sent).
7. Click "تأكيد الاسترداد". You see "سُجّل الاسترداد". The customer gets a notification.

**Effects**

| Refund | Access effect | Message you see |
|---|---|---|
| Full, subscription order | The months that order bought are taken off. If nothing is left, the subscription ends now | "ينتهي اشتراك ... الآن" or "تُقصَّر مدة اشتراك ... لتنتهي في ..." |
| Full, scheduled downgrade | The scheduled downgrade is removed, the subscription stays | "يُلغى التخفيض المجدول ..." |
| Partial | Access does not change | "اشتراك ... لا يتغيّر" |
| Credit pack | Credits are clawed back by your number (unused part only) | the credits lines above |

The record appears in "الاستردادات" with its state ("مطلوب", "معتمد", "تم", "فشل", "مرفوض") and the transfer reference.

**What can go wrong**

| Problem | Do |
|---|---|
| You recorded a refund but did not send the money | Send it now with the same reference; there is no "undo" button (not in the console yet). Tell the owner. |
| You sent the money but recording fails | Retry. If it keeps failing, do not refund twice; ask the owner and look at the logs (section 9). |
| Alert "payment.review_needed" about a refund you did not record | The gateway reports a refund Wasfa does not know. Record it here with the Kashier reference. Nothing changed automatically. |
| A second success on an already paid order (double payment alert) | Refund the extra payment (section 8). |

---

## 4. Change a price safely

**Rule of thumb:** edits stay a **draft** until you publish. Existing subscribers keep their price until their next renewal.

**Steps (billing write permission, fresh sign-in)**

1. Go to "الباقات والأسعار", pick the plan from "الباقات".
2. Open the tab "الأسعار" (Prices). The grid shows price per period ("{n} شهر") and currency. An empty cell means "غير متاح" (not offered in that period and currency). Amounts are typed as whole currency amounts.
3. Edit cells. The helper "السنة = الشهري × 10" fills the yearly price. "إضافة عملة (3 أحرف)" adds a currency column. Edits show "تعديلات غير محفوظة" / "مسودة غير منشورة".
4. Check the tab "الهامش" (Margin calculator). It shows for each price: the AI cost for the period, the margin, and the usage level at which you break even. Colours: "هامش جيد", "هامش منخفض" (under 50%), "هامش سالب" (negative; selling at a loss).
5. Check the preview "كما يراها العميل": choose "جوال"/"حاسوب", a currency and a period. The preview shows your draft without promotions or coupons.
6. Click "نشر الأسعار". The dialog "نشر أسعار ..." shows:
   - how many active subscribers keep their current price until renewal ("... مشترك نشط يحتفظون بسعرهم الحالي حتى التجديد");
   - "ما سيتغيّر" (the exact diff: new prices, changed prices, removed prices);
   - margin warnings.
   If any margin is negative you must tick "أؤكد النشر رغم الهامش السالب" to continue.
7. Click "نشر الأسعار" in the dialog. You see "نُشرت أسعار ...".
8. Customers see the new prices within about 60 seconds (the catalog is cached for about a minute). Do not worry if the pricing page shows the old price for a minute; reload after that.

**What can go wrong**

| Problem | Do |
|---|---|
| "لا تملك صلاحية نشر الأسعار" | You lack the permission; ask the owner. |
| Published but the page shows the old price after 2 minutes | Hard-reload the page; if still old, tell the owner and check the logs (section 9). |
| Wrong price published | Edit the cells again and publish again. Orders already created keep the price they were quoted. |
| A customer complains about a price they were quoted | A quote lives 15 minutes (`billing.quoteTtlMinutes`) and an order 24 hours (`billing.orderTtlHours`); within that they pay the quoted price. |

---

## 5. Create a promotion or coupons

**Promotion** = a discount shown on the pricing page automatically. **Coupon** = a code the customer types. Promotions: "العروض". Coupons: "الكوبونات".

### Promotion

1. "العروض" -> "عرض جديد". A four-step wizard:
   1. "ماذا": internal name (customers do not see it), Arabic/English titles and badge, kind ("نسبة خصم", "مبلغ ثابت", "رصيد هدية", "أشهر إضافية", "تمديد التجربة") and its value.
   2. "أين ولمن": plans (empty means all), periods, audience (individuals, organizations), countries, minimum order amount, "للعملاء الجدد فقط".
   3. "متى وكم": start and end ("يبدأ في", "ينتهي في"; shown in your device's time zone), overall limit, limit per customer, priority, "الجمع مع غيره" (stacking), "إظهار العرض في صفحة الأسعار", and a countdown (needs a real end date).
   4. "مراجعة": plain-Arabic sentence of the rule ("بالعربي البسيط:"), three sample baskets with the price before and after (an estimate; the price engine is the truth), and a margin warning if the discount cuts the margin too much.
2. Click "حفظ كمسودة" (draft) or "حفظ ونشر" (save and publish).
3. In the list use "نشر", "إيقاف" (pause), "استئناف" (resume), "إنهاء" (end; cannot be resumed) and "نسخ" (copy as draft).
4. Test it: the simulator "جرّب السعر" computes what a customer would pay with a plan and code, without creating an order.

Statuses: "مسودة", "مجدول" (scheduled), "ساري" (active), "موقوف", "منتهٍ". Scheduled promotions start and end by themselves.

### Single coupon

1. "الكوبونات" -> "كوبون جديد".
2. "الكود": capital English letters, digits and dash, 4 to 32 characters. Choose the kind and value, optionally "تخصيص لعميل" (only that customer can use it) and a campaign.
3. "إنشاء الكوبون", then "نشر" in the coupon row.

### Bulk coupons and CSV

1. "الكوبونات" -> "دفعة كوبونات".
2. Set "عدد الكوبونات" (up to 5,000), optional "بادئة الكود" and the random part length, the campaign, and the rule.
3. "إنشاء الدفعة". You see "تم إنشاء ... كوبون في الدفعة ...".
4. Click "تنزيل CSV" to download the codes (give them to your partner or campaign). Keep the file private: anyone with a code can use it.
5. The batch is a draft. Use "نشر الدفعة", and later "إيقاف الدفعة", "استئناف الدفعة", "إنهاء الدفعة" to control all its codes at once.

**What can go wrong**

| Problem | Do |
|---|---|
| Code does not work for a customer | Use the simulator with their account. The customer sees one generic message for every refusal (not started, used up, wrong plan, not for them); you see the real reason in the simulator ("غير صالح لهذا الطلب" etc.). |
| Discount too deep | "إيقاف" the promotion at once; orders already paid are not changed. |
| A bulk batch fails halfway | Check the batch list; do not retry blindly or you create duplicates. |
| Several discounts apply | "لا يجتمع مع خصم آخر" means exclusive; the engine picks the best allowed; total discount is capped by `billing.maxTotalDiscountBps` (70% by default). |

---

## 6. Change the receiving account number (InstaPay / Vodafone Cash)

**Why it is protected:** if someone steals an admin account and changes this number, customers' money goes to the thief. So it needs extra proof and a delay.

**Steps (billing write permission, fresh sign-in AND a current authenticator code)**

1. Go to "طرق الدفع والرسوم", open the method (InstaPay or Vodafone Cash), find the block "رقم الحساب". It shows "الرقم الحالي:".
2. Fill "تغيير رقم الحساب":
   - "الرقم الجديد": an Egyptian mobile number or an InstaPay address;
   - "اسم صاحب الحساب";
   - "رمز المصادقة الثنائية": the 6-digit code from your authenticator app.
3. Click "طلب تغيير الرقم". You see "سُجّل الطلب وبدأت مهلة العشر دقائق".
4. The block now shows "تغيير رقم قيد الانتظار" with the old and new numbers and a countdown "يُطبَّق التغيير بعد". For 10 minutes the **old number stays in use**.
5. **Every admin with billing write permission gets a critical alert** on all enabled channels when it is requested, canceled and applied.
6. After 10 minutes a job (runs every minute) applies it and writes an audit entry. The text becomes "جارٍ تطبيق التغيير" and then the new number is live.
7. **To cancel:** a **different** admin (not the one who asked) opens the same block and clicks "إلغاء التغيير". You see "أُلغي تغيير الرقم". Only one pending change per method at a time.

**What can go wrong**

| Problem | Do |
|---|---|
| You did not request this change but got the alert | Treat as an incident. Cancel it immediately ("إلغاء التغيير"), then ask the owner to reset the password and authenticator of the admin who requested it. |
| Authenticator code rejected | Wait for the next code and retry; check the phone clock. |
| You want to cancel your own request | You cannot; ask another admin. |
| The number is wrong after it was applied | Request a new change; it waits another 10 minutes. Until then tell customers by hand or turn the method off with the "مفعّلة للعملاء" switch in "تعديل الطريقة". |
| Money arrived at the old number after the change | Normal for transfers made earlier. Check both wallets when reviewing. |

The same screen lets you edit fees, limits and the payment instructions shown to customers ("تعليمات الدفع بالعربية/بالإنجليزية"; use only the placeholders `{amount}`, `{reference}`, `{account}`). The account number cannot be changed anywhere else.

---

## 7. Rotate Kashier keys, or switch test <-> live

Changing keys or mode **switches the gateway off** and its methods with it, raises a critical alert, and starts a 10-minute cooldown. Card payments stay off until you re-verify with a real test payment. Plan for 15 to 20 minutes of no card payments (manual methods keep working).

**Where:** "بوابة الدفع" (`/admin/billing/gateways`), card "إعداد بوابة الدفع" / "كاشير".

**Rotate keys**

1. Get the new values in the Kashier dashboard: merchant ID, payment API key, secret API key. Never send them in chat or email.
2. In "تحديث بيانات الاعتماد" fill "معرّف التاجر (MID)", "مفتاح واجهة الدفع", "المفتاح السري لواجهة API" and "سبب التغيير". Click "حفظ بيانات الاعتماد".
3. The keys are stored encrypted and never shown again ("لن تظهر المفاتيح المحفوظة مرة أخرى"); only a short hint "مفتاح الدفع المحفوظ" remains.
4. The gateway shows "البوابة متوقفة". The blockers are listed (for example "اختبر الاتصال بعد آخر تغيير لبيانات الاعتماد").
5. Click "اختبار الاتصال". Expected: "تم الاتصال بنجاح". Failure messages: "بيانات الاعتماد غير صحيحة." (wrong keys) or "تعذر الوصول إلى خدمة كاشير مؤقتًا." (try again later).
6. In "التحقق بدفع حقيقي": enter "المبلغ بالجنيه (1 إلى 50)", click "بدء دفعة اختبار", pay on the Kashier page, then click "التحقق الآن". All of these must show a success tick:
   - "تم إنشاء صفحة الدفع"
   - "أكدت واجهة الحالة نجاح الدفع"
   - "وصل إشعار الويب هوك"
   - "تم التحقق من توقيع الإشعار"
   - "المبلغ والعملة متطابقان"
   Test payments never create orders, credits or revenue.
7. Wait until the cooldown ends ("الوقت المتبقي قبل الإتاحة"; blocker "انتظر انتهاء مهلة الأمان البالغة 10 دقائق.").
8. Click "إتاحة بوابة الدفع". It becomes "البوابة مفعّلة".
9. Then turn on the card method(s) if they are off: the section "طرق الدفع المرتبطة" lists the methods linked to the gateway, and the "مفعّلة للعملاء" switch is under "طرق الدفع والرسوم". A method can only be enabled when its gateway is enabled and verified.

**Switch test <-> live**

1. Click "تغيير الوضع", choose "تجريبي" (test) or "مباشر" (live), write "سبب تغيير الوضع".
2. For live, type `LIVE` in the confirm box ("اكتب LIVE للتبديل إلى الوضع المباشر").
3. Then follow steps 4 to 9 above. In live mode the test payment charges **real money** ("وضع مباشر: ستُحصّل هذه الدفعة مبلغًا حقيقيًا"; type LIVE again to start). Use the smallest amount (1 EGP) and refund it in the Kashier dashboard afterwards.
4. Make sure the keys you saved belong to the same mode (test keys with test mode, live keys with live mode).

**What can go wrong**

| Problem | Do |
|---|---|
| "تعذر التحقق من الاتصال" / wrong keys | Re-enter the keys carefully (no spaces). |
| The webhook tick never appears | Kashier cannot reach us; see section 9. The "إعداد Webhook" box shows the URL (copy with "نسخ الرابط"). Wasfa sends that URL with every payment automatically; nothing to paste into Kashier unless Kashier support asks. |
| Signature check fails ("فشل التحقق") | Wrong payment API key, or the webhook comes from the other mode. Re-check keys and mode. |
| Customers cannot pay by card after a change | Expected until step 8. If still off afterwards, check that the card method is on. |
| Not sure which blocker remains | Read the blockers list under the "إتاحة بوابة الدفع" button; each tells you the next step. |

Note: the real Kashier webhook body and signature header have not yet been checked against live traffic (only the status API and the redirect signature were). The verification payment above is exactly the check that proves it; do not skip it. (Verify after deploy.)

---

## 8. A disputed payment, or "I paid but nothing happened"

**First, find out which kind of payment it is.**

1. Search the customer's phone, the `WSO-` order number or the `WSP-` reference with Ctrl+K, or go to "المدفوعات" and filter by "الحالة".
2. Open the payment and read "سجل الأحداث" (timeline) and "الحالة".

| Status | Meaning | Do |
|---|---|---|
| "بانتظار العميل" | Customer has not finished or has not uploaded a proof | Tell them to complete payment on the order page. |
| "بانتظار المراجعة" / "بانتظار الموافقة الثانية" | Manual payment waiting for us | Review it (section 2). |
| "قيد المعالجة" | Card payment sent, no answer from Kashier yet | Wait. The system asks Kashier itself every 5 minutes (below). |
| "ناجحة" | Paid; access should be active | Check "الاشتراكات" for the customer. If not active, see "Paid but no access". |
| "فشلت" | Failed | Customer can retry; each retry is a new attempt. |
| "منتهية" | Order expired unpaid (orders expire after 24 hours) | See "Late success". |

**Card payments (Kashier)**

- Normally Kashier notifies us (webhook) within seconds.
- If the webhook is missing, **reconciliation** runs **every 5 minutes**: for payments in progress older than 10 minutes it asks Kashier for the real status and applies the result. So a card payment that did succeed is activated automatically within about 15 minutes even with no webhook. For up to 24 hours after expiry it still checks, so late successes are caught.
- **Late success:** a payment that succeeded after the order expired is still activated. If its coupon is full, the discount is kept and an alert is raised.
- A manual "check Kashier now" button for ordinary payments is **(not in the console yet)**. The "التحقق الآن" button exists only for gateway test payments.
- **Amount mismatch:** if Kashier reports a different amount or currency than the order, the attempt fails and an alert `payment.amount_mismatch` is raised. Do not activate by hand. Look at the Kashier dashboard, then decide: if the customer paid, refund (section 3) and ask them to pay again.

**Double payment:** a second success on an order that is already paid is recorded and raises a **critical** alert (`payment.review_needed`). The customer is not given a second period. Refund the extra payment (section 3), recording the Kashier reference.

**Paid but no access** (payment shows "ناجحة")

1. Open "الاشتراكات", search the customer.
2. A background job ("subscriptions.backfill") activates paid subscription orders that have no period yet at start and nightly at 02:40 UTC; the lifecycle job runs every 15 minutes. Wait 15 minutes first.
3. If still nothing, extend the subscription by hand from the subscription detail: "تمديد" (by months or until a date; no payment is taken), and report the case to the owner for a code fix.

**Customer says they paid by card but there is no payment record at all:** ask for the Kashier receipt number; search the Kashier dashboard. If the money was taken but Wasfa has nothing, the customer probably never returned or the payment id differs; ask the owner (this needs a developer to look in the logs).

---

## 9. When webhooks stop

**Signs**

- Card payments stay "قيد المعالجة" for more than a few minutes, then change by themselves roughly every 5 minutes (that is reconciliation doing the job).
- Gateway test: "وصل إشعار الويب هوك" never ticks.
- Payment timeline shows "رُفض توقيع الإشعار" ("توقيع الإشعار غير صحيح"): the webhook arrived but the signature is wrong (wrong key or mode).
- Failure-spike or "no payments in hours" alerts (section 10).

**What keeps working**: reconciliation (every 5 minutes) catches up successes without webhooks, so nobody loses a paid order. It only adds delay. Manual payments are not affected.

**What to check, in order**

1. Is Kashier itself in trouble? Check the Kashier dashboard/status.
2. Is the API alive? On the server (see `DOCKER-GUIDE.md` section 4; `dc` is the alias defined there):
   - `dc ps`: all services healthy.
   - `dc logs -f --tail 100 api`: look for webhook errors or signature rejections.
   - `dc logs -f --tail 100 worker`: confirm "Payments reconciled" appears when payments are pending.
3. Is the URL right? The webhook URL is `<API_PUBLIC_URL>/webhooks/kashier`; the exact URL is shown in "إعداد Webhook" on the gateway page. If `API_PUBLIC_URL` in `.env.prod` is wrong, Kashier calls the wrong address.
4. Are keys/mode correct? Re-run the verification payment (section 7).
5. **Cloudflare WAF / bot rules (verify after deploy):** a security rule may block Kashier's server requests to `/webhooks/*`. In the Cloudflare dashboard check Security -> Events for blocked requests to that path, and add an allow rule for it. The exact rule is not documented in `DOCKER-GUIDE.md` yet; whether the production setup already has it must be verified after deploy.
6. **Caddy (verify after deploy):** `dc logs --since 1h caddy` should show `POST /webhooks/kashier` requests with status 200 or 401. No lines at all means the request is blocked before Caddy (Cloudflare or firewall). The API limits webhooks to a payload of 256 KB and rate-limits per IP; no special Caddy rule for webhooks has been set up that this runbook can confirm.

**Looking at the logs**: the logs may contain ids but never card data or full phone numbers. Do not paste log lines containing keys anywhere.

**After the cause is fixed**: nothing needs to be re-sent by hand; reconciliation reads each pending payment's real state. Check "المدفوعات" with the filter "قيد المعالجة" is empty after about 15 minutes.

---

## 10. Alerts

**What triggers one (billing):** `payment.review_needed` (new transfer to review, double payment, or an unrecorded refund), `payment.review_overdue` (transfer waiting past its limit), `payment.amount_mismatch`, `payment.failure_spike` (many card failures in a short window), account-number change events, gateway keys/mode changed, drift found by nightly consistency checks, and others in `BILLING.md` section 10.

**Who gets them:** admins with the alerts permission plus the permission for that kind (for example payment review). The `super_admin` role gets all.

| Channel | Default | Notes |
|---|---|---|
| In-app | On | Always on. |
| Email | On | Critical alerts bypass the daily email cap. |
| Telegram | On if the bot is configured | Plain text, no personal data. |
| WhatsApp | **Off** | See below. |

**Throttling:** non-critical alerts on email, Telegram and WhatsApp are sent at most once per 10 minutes per admin and channel; the rest of that window arrives as **one digest** (count plus up to 5 summaries). Critical alerts and in-app are never throttled and ignore mutes.

**Telegram setup** (once per admin)

1. The server owner puts the bot token in `.env.prod`: `ALERT_TELEGRAM_BOT_TOKEN` (if empty, the backup bot's `BACKUP_ALERT_TELEGRAM_BOT_TOKEN` is used), then runs `dc up -d` (see `DOCKER-GUIDE.md` section 4). Never share the token.
2. Each admin opens Telegram, finds the bot and presses Start.
3. The admin finds their numeric chat id (any "get my id" bot shows it).
4. The chat id is saved in the admin's alert preferences (`telegramChatId`, digits only, 5 to 20), with Telegram turned on.
5. **A screen for this is (not in the console yet).** The preferences exist in the API (`GET/PUT /admin/alerts/prefs`: `inAppEnabled`, `emailEnabled`, `telegramEnabled`, `whatsappEnabled`, `telegramChatId`, `mutedKinds`); until a screen is built, ask the developer to set them. The alerts bell/inbox is also **(not in the console yet)**; rely on email and Telegram.

**Muting:** an admin can mute chosen non-critical alert kinds (`mutedKinds` in the same preferences; same note: no screen yet). Critical alerts cannot be muted.

**Why WhatsApp alerts are off by default:** the WhatsApp number is an unofficial client. Sending many messages risks a ban, and a ban would also break phone verification for customers. So alerts to admins on WhatsApp ship **off** (setting `alerts.whatsapp.enabled = false` and `WA_ALERTS_ENABLED=false`). If the owner turns both on: only admins who messaged `تنبيهات` or `ALERTS ON` to the bridge from their **verified** phone are linked, at most 20 messages per day in total, and there are no links in the text. Prefer email and Telegram. The safer official route (WhatsApp Cloud API) is an open question for the owner.

**Customer WhatsApp messages** (receipts, reminders) are a different thing: they are controlled in `/admin/whatsapp` ("رقم واتساب") in the card "Customer messages" and also ship off.

**If you stop receiving alerts:** check your spam folder, whether Telegram was blocked, and whether you still have the permission; ask the developer to check the `alert_deliveries` table state.

---

## 11. Withdrawals (pay a reward withdrawal)

**When:** a `withdrawal.requested` alert arrives (email, in-app, Telegram), or the queue shows waiting requests. Cash-out is off until the owner sets `rewards.cashOutEnabled` (and `rewards.enabled`) in **الإعدادات → rewards**, which waits for the accountant's answer on paying rewards to individuals.

1. Open **النمو → طلبات السحب** (`/admin/growth/withdrawals`). Overdue requests are at the top; J / K move through the list.
2. In the review pane check: the amount (points and EGP, at the rate snapshotted when the person asked), **account age**, **lifetime earned**, **open reward debt**, the flags (**أول سحب** always gets a careful look), and **المكافآت التي كوّنت الرصيد** (which referrals and orders produced the cash points). A balance built from one referral by someone just created is a reason to look at **النمو → الاحتيال والتعليق** first.
3. Press **موافقة** and confirm your password if asked. At or above `rewards.fourEyesThresholdPoints` the first approval only records you; a **different** admin must approve too. You can never approve or pay your own request.
4. Press **إظهار الرقم** (needs `withdrawals.pay`, writes an audit row) and **نسخ المبلغ والرقم**. Send the money from the InstaPay / Vodafone Cash app.
5. Press **تسجيل الدفع** and paste the transfer reference exactly as the app shows it. The same reference on another request is refused. The person gets a "paid" notice with the reference.
6. To refuse: **رفض**, choose the reason, optionally a short note (it reaches the person as written: no personal data). The points go back to their cash balance at once.

**Weekly:** press **ملف الأسبوع للمحاسب (CSV)** and send it to the accountant. The nightly `withdrawals.reconcile` job compares paid requests with the points ledger; a difference raises `points.reconcile_drift`: stop paying and tell the developer.

**What can go wrong:** "يراجع هذا الطلب الآن" means another admin opened it in the last 5 minutes: wait, or **تولّي المراجعة** if you agreed so. A destination that is still in its cooldown cannot be used: the person sees when it becomes usable.

---

## 12. Give an institution a member price (deal + join link)

1. **النمو → الصفقات → صفقة جديدة**. Step **لمن**: name the deal (e.g. «سعر أعضاء صيدلية النور»), target **مؤسسة**, search and pick the organisation.
2. Step **ماذا**: add a price rule (plan, fixed price in EGP or percent off), optionally a referrer commission, welcome credits, a seat limit.
3. Step **المدة**: how long the member price follows each member (months), optionally «للأعضاء الجدد فقط», a join-link slug (e.g. `alnour-pharmacy`), an end date, and whether promotions or coupons may stack.
4. Step **المعاينة** shows a new member's checkout price before and after and why the deal applies. Press **تفعيل** (password). The join link and a printable QR card appear: print it for the counter.
5. Members open `wasfa.online/join/<slug>`, register, verify, and see the member price at checkout as a discount line.

Pause or end a deal from its drawer; an ended deal is final. A deal never pushes a price below the minimum charge.

## 13. Release, void or block held rewards (fraud queue)

**النمو → الاحتيال والتعليق** lists referrals the fraud rules held (same phone, same payer number, same device, fast sign-ups, weekly budget). Read the chips and the chain, tick the rows, then **تحرير** (the points release when their hold ends), **إلغاء** (pending points reversed) or **حظر الداعي** (all their referrals blocked, pending points reversed, code paused). A reason is required and audited.

## 14. Run a copy experiment

**النمو → التجارب → تجربة جديدة**. The key `prompt_<kind>` (e.g. `prompt_credits_low`) varies the text of that prompt; arm `a` is the control, `b` the variant (its Arabic text is the `growth.prompt.<kind>.b` string). **بدء** starts it; people keep the same arm. In the results, a red row means a guardrail (refunds, support contacts, dismissals, unsubscribes) got worse than the control beyond `growth.experiments.guardrailBps`: do not promote it, whatever its conversion. **إيقاف** then **إكمال** when done.

## Glossary

| Word | Meaning |
|---|---|
| **Quote** | The price Wasfa calculated for a customer (plan, months, discounts, tax, fee). It is signed and valid for 15 minutes. The customer cannot change it. |
| **Order** | What the customer wants to buy, with a number `WSO-...`. It expires if unpaid (24 hours by default). One order can have several payment attempts. |
| **Payment** | One attempt to pay an order, with its own status and, for manual methods, a reference `WSP-...`. A card retry is a new payment on the same order. |
| **Outbox** | A to-do list in the database. When something is paid or refunded, the follow-up actions (notification, receipt email) are written there in the same step and sent by a worker every 30 seconds. Nothing is lost if a service restarts. |
| **Reconciliation** | A job that asks Kashier every 5 minutes for the true status of payments still in progress, so missing webhooks do not matter. A nightly consistency check also compares totals and logs differences. |
| **Webhook** | A message Kashier sends to Wasfa when a payment changes. Fast, but not relied on alone. |
| **Four-eyes** | Two different admins must approve a large manual payment. |
| **Cooldown** | A mandatory waiting time (10 minutes) after a risky change such as keys, mode or the receiving number. |
