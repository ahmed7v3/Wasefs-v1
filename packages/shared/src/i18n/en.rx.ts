import type { arRx } from "./ar.rx.js";

/** English for the prescription pipeline: keys without an entry fall back to Arabic. */
export const enRx: Partial<Record<keyof typeof arRx, string>> = {
  "rx.step.read": "Reading the prescription",
  "rx.step.match": "Matching the drugs",
  "rx.step.verify": "Checking unclear lines",
  "rx.step.finalize": "Preparing the result",
  "rx.leaveHint": "You can leave this page; we will keep the result in your history.",
  "rx.empty.guidance": "We could not read the prescription. Try a clearer photo. You were not charged.",
  "rx.failed": "The analysis could not be completed. You were not charged.",
  "rx.unmatched": "Unconfirmed",
  "rx.badge.high": "High confidence",
  "rx.badge.medium": "Medium confidence",
  "rx.badge.low": "Low confidence",
  "rx.finding.duplicate_ingredient": "The same active ingredient appears in more than one line. Ask the pharmacist.",
  "rx.finding.strength_unknown": "This strength is not listed for this drug. Ask the pharmacist.",
  "rx.nearDuplicate": "You analysed a similar prescription before. Open the earlier analysis?",
  "rx.error.tooManyPages": "This is more pages than your plan allows.",
};
