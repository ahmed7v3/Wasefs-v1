# Phase 3 legal text drafts (for the owner and a lawyer)

> Task 3.17: drafts of the additions to `/terms` and `/privacy` that Phase 3 needs. They describe what
> the code does today. **Not published**: the live pages change only after the owner (and a lawyer)
> approve the wording. Arabic first; the English versions follow the same order.

---

## A. Terms: payments and subscriptions (الشروط: المدفوعات والاشتراكات)

**عربي**

1. الأسعار معروضة بالعملة المحلية، ويظهر الإجمالي كاملًا (بما فيه أي ضريبة أو رسوم) قبل الدفع. لا تُضاف أي رسوم بعد الضغط على «ادفع».
2. الاشتراكات مدفوعة مقدمًا لمدة محددة (شهر أو 3 أو 6 أو 12 شهرًا) ولا تتجدد تلقائيًا. نرسل لك تذكيرًا قبل انتهاء المدة، والتجديد بقرارك.
3. وسائل الدفع: البطاقة عبر بوابة كاشير، أو التحويل عبر إنستاباي أو فودافون كاش مع إرسال إثبات التحويل. التحويلات تُراجع يدويًا قبل تفعيل الاشتراك.
4. عند الترقية تُخصم القيمة المتبقية من اشتراكك الحالي من سعر الباقة الجديدة. التخفيض يبدأ عند نهاية المدة الحالية.
5. الرصيد الشهري للباقة يُمنح في بداية كل شهر من الاشتراك، ورصيد الباقة غير المستخدم لا يُرحَّل إلى الشهر التالي.
6. يتم الاحتفاظ بإثباتات التحويل لمدة [365] يومًا لأغراض المحاسبة ومنع الاحتيال ثم تُحذف.

**English**

1. Prices are shown in the local currency and the full total (including any tax or fee) is shown before payment. No fee is ever added after you press "Pay".
2. Subscriptions are prepaid for a fixed period (1, 3, 6 or 12 months) and do not renew automatically. We remind you before the period ends; renewing is your choice.
3. Payment methods: card through the Kashier gateway, or an InstaPay / Vodafone Cash transfer with a proof of transfer. Transfers are reviewed by hand before the subscription starts.
4. On an upgrade, the remaining value of your current period is deducted from the new plan's price. A downgrade starts at the end of the current period.
5. A plan's monthly credits are granted at the start of each subscription month; unused plan credits do not carry over.
6. Transfer proofs are kept for [365] days for accounting and fraud prevention, then deleted.

## B. Terms: refunds (الاسترداد)

**عربي** — يمكنك طلب استرداد خلال [7] أيام من الدفع إذا لم تستخدم أكثر من [x]% من رصيد الفترة. يُرد المبلغ بنفس وسيلة الدفع، أو بتحويل لمحفظتك في حالة التحويلات. عند الاسترداد الكامل تنتهي مدة الاشتراك المستردة وقد يُخصم الرصيد غير المستخدم. *(نافذة الاسترداد وشروطها قرار المالك: الإعداد `billing.refundWindowDays` حاليًا 7.)*

**English** — You may ask for a refund within [7] days of payment if you used no more than [x]% of the period's credits. The money goes back by the same method, or by a transfer to your wallet for transfers. A full refund ends the refunded period and unused credits may be taken back. *(Window and conditions are the owner's decision; the setting `billing.refundWindowDays` is 7 today.)*

## C. Terms: the invites and rewards program (برنامج الدعوات والمكافآت)

**عربي**

1. النقاط مكافأة على دعوة الآخرين، وليست مالًا ولا يمكن شراؤها أو نقلها لحساب آخر.
2. تُمنح نقاط عند توثيق من دعوته لحسابه (نقاط تُحوَّل إلى رصيد فقط)، وعند أول اشتراك مدفوع له وتجديداته (نقاط قابلة للسحب أو للتحويل إلى رصيد) حسب القواعد المعروضة في صفحة «الدعوات والمكافآت».
3. تبقى النقاط «معلّقة» مدة الانتظار المعروضة (حاليًا [14] يومًا للمدفوعات) لحماية الطرفين من الاسترداد والاحتيال، ثم تُضاف إلى رصيدك.
4. إذا استُرد اشتراك صديق تُعكس النقاط المرتبطة به، وإن كانت قد صُرفت يُسجَّل دَين يُخصم من مكافآتك القادمة.
5. قد نعلّق أو نلغي مكافآت إذا ظهرت مؤشرات احتيال (نفس الهاتف أو الجهاز أو وسيلة الدفع، أو تسجيلات كثيرة متتالية)، ويمكنك التواصل معنا لمراجعة القرار.
6. السحب النقدي: الحد الأدنى [1000] نقطة، إلى محفظة أو حساب باسمك، بعد مراجعة يدوية، وبمدة انتظار للوسيلة الجديدة. *(السحب النقدي مغلق حتى يجيب المحاسب عن المعاملة الضريبية والقانونية للمكافآت النقدية للأفراد.)*
7. يحق لنا تعديل قواعد البرنامج مستقبلًا دون أثر رجعي على نقاط اكتُسبت فعلًا.

**English**

1. Points reward inviting others; they are not money and cannot be bought or moved to another account.
2. Points are earned when someone you invited verifies their account (credit-only points), and on their first paid subscription and renewals (points you can withdraw or convert to credits), under the rules shown on the "Invites and rewards" page.
3. Points stay "pending" for the stated hold (currently [14] days for payments) to protect both sides from refunds and fraud, then join your balance.
4. If a friend's subscription is refunded, the related points are reversed; if they were already spent, a debt is recorded and offset against future rewards.
5. We may hold or void rewards when there are signs of fraud (same phone, device or payment number, or many sign-ups in a row); you can contact us to review the decision.
6. Cash withdrawals: minimum [1,000] points, to a wallet or account in your name, after a manual review, with a waiting time for a new destination. *(Cash-out stays off until the accountant answers on the tax and legal treatment of cash rewards to individuals.)*
7. We may change the program's rules in the future without retroactive effect on points already earned.

## D. Privacy: payments, rewards and marketing (الخصوصية)

**عربي**

- **المدفوعات:** نحفظ بيانات الطلب والمبلغ ووسيلة الدفع. أرقام البطاقات لا تمر بنا (تدخلها في صفحة كاشير). رقم المحفظة المحوَّل منه يُحفظ مشفّرًا ولا يراه إلا مراجع الدفع.
- **وسائل استلام المكافآت:** تُحفظ مشفّرة، ونعرض آخر الأرقام فقط. يظهر الرقم كاملًا لمسؤول الدفع عند التحويل فقط، ويُسجَّل كل إظهار.
- **الدعوات:** من دعوته لا يرى بريدك أو هاتفك أو اسمك، بل الحروف الأولى فقط.
- **رسائل النصائح والعروض:** لا نرسلها إلا إذا وافقت صراحة، رسالة واحدة في الأسبوع على الأكثر، ويمكنك الإلغاء بنقرة من أي رسالة أو من صفحة حسابك.
- **القياس:** نسجّل أحداثًا مجهولة المحتوى (مثل فتح صفحة الأسعار أو بدء الدفع) لتحسين الخدمة، بدون أي بيانات صحية أو نصوص تكتبها، وتُحذف بعد 13 شهرًا.

**English**

- **Payments:** we keep the order, amount and method. Card numbers never pass through us (you type them on Kashier's page). The wallet number a transfer came from is stored encrypted and only the payment reviewer sees it.
- **Reward payout destinations:** stored encrypted; we show only the last digits. The full number is shown to the paying admin only when paying, and every reveal is logged.
- **Invites:** people you invited never see your email, phone or name, only initials.
- **Tips and offers email:** sent only if you opted in, at most one a week; unsubscribe in one click from any message or from your account page.
- **Measurement:** we record content-free events (like opening the pricing page or starting checkout) to improve the service, with no health data and no text you typed; they are deleted after 13 months.

## E. Privacy: staff access to prescriptions and chats (اطلاع فريق الدعم)

**عربي** — لا يطّلع أي موظف على روشتاتك أو محادثاتك إلا إذا كانت لديه صلاحية خاصة، ولسبب محدد يختاره (طلب دعم منك، نزاع، مراجعة احتيال، مراجعة جودة)، في جلسة لا تتجاوز 30 دقيقة. كل فتح لروشتة أو محادثة يُسجَّل في سجل تدقيق لا يمكن تعديله، ولا يمكن تصدير هذه البيانات من لوحة الإدارة.

**English** — No staff member can open your prescriptions or chats unless they hold a dedicated permission, for a specific reason they choose (your support request, a dispute, a fraud review, a quality review), in a session of at most 30 minutes. Every open is written to an audit log that cannot be edited, and this data cannot be exported from the admin console.
