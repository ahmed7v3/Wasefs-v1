/*
 * Strings of the prescription pipeline (Phase 2, Task 2.8): the four progress steps, the badges
 * and the deterministic findings. The API and the worker send ids only (`read`, `high`,
 * `duplicate_ingredient`); the screens turn them into these words.
 */
export const arRx = {
  "rx.step.read": "قراءة الروشتة",
  "rx.step.match": "مطابقة الأدوية",
  "rx.step.verify": "التحقق من البنود غير الواضحة",
  "rx.step.finalize": "تجهيز النتيجة",
  "rx.leaveHint": "يمكنك مغادرة هذه الصفحة؛ سنحتفظ بالنتيجة في سجلك.",
  "rx.empty.guidance": "لم نتمكن من قراءة الروشتة — جرّب صورة أوضح. لم نخصم أي رصيد.",
  "rx.failed": "تعذّر إكمال التحليل. لم نخصم أي رصيد.",
  "rx.unmatched": "غير مؤكد",
  "rx.badge.high": "ثقة عالية",
  "rx.badge.medium": "ثقة متوسطة",
  "rx.badge.low": "ثقة منخفضة",
  "rx.finding.duplicate_ingredient": "مادة فعالة مكررة بين أكثر من دواء — راجع الصيدلي.",
  "rx.finding.strength_unknown": "هذا التركيز غير مسجّل لهذا الدواء — راجع الصيدلي.",
  "rx.nearDuplicate": "حلّلت روشتة تشبه هذه من قبل. هل تريد فتح التحليل السابق؟",
  "rx.error.tooManyPages": "عدد الصفحات أكبر من المسموح به لباقتك.",
} as const;
