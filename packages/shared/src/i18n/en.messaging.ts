import type { arMessaging } from "./ar.messaging.js";

/** English counterpart of `ar.messaging.ts` (server-sent texts: WhatsApp follow-ups, document labels). */
export const enMessaging: Partial<Record<keyof typeof arMessaging, string>> = {
  "whatsapp.agent.event.paid":
    "Your payment for order {number} was approved and {item} is active. Thank you for choosing Wasfa AI.",
  "whatsapp.agent.event.rejected":
    "We could not approve the payment for order {number} ({item}): {reason}. You can send a new receipt here in the chat and we will review it.",
  "whatsapp.agent.event.resubmit":
    "We need a clearer receipt for the payment of order {number} ({item}). Send a clearer picture here in the chat and we will review it.",
  "whatsapp.agent.event.packItem": "your credit pack",
  "whatsapp.agent.event.rxDone.header": "📋 I read the prescription — medicines: {count}",
  "whatsapp.agent.event.rxDone.date": "📅 Prescription date: {date}",
  "whatsapp.agent.event.rxDone.item": "{index}. {line}",
  "whatsapp.agent.event.rxDone.medicine": "💊 *{name}*",
  "whatsapp.agent.event.rxDone.dose": "• Dose: {value}",
  "whatsapp.agent.event.rxDone.frequency": "• How often: {value}",
  "whatsapp.agent.event.rxDone.duration": "• Duration: {value}",
  "whatsapp.agent.event.rxDone.route": "• How to use: {value}",
  "whatsapp.agent.event.rxDone.notes": "• Doctor's instructions: {value}",
  "whatsapp.agent.event.rxDone.purpose": "• Used for: {value}",
  "whatsapp.agent.event.rxDone.precaution": "• ⚠️ {value}",
  "whatsapp.agent.event.rxDone.times": "• 🕗 Suggested times: {value}",
  "whatsapp.agent.event.rxDone.overview": "🩺 Summary: {value}",
  "whatsapp.agent.event.rxDone.finding": "⚠️ {text} {items}",
  "whatsapp.agent.event.rxDone.pdfNote":
    "📄 I sent you a PDF with all the details and a dosing timetable",
  "whatsapp.agent.event.rxDone.lowConfidence": "(uncertain reading, check with your pharmacist)",
  "whatsapp.agent.event.rxDone.unreadable":
    "Some areas of the prescription could not be read, so check them yourself or ask your pharmacist.",
  "whatsapp.agent.event.rxDone.link": "The full result and details of each medicine:",
  "whatsapp.agent.event.rxFailed":
    "We could not read the prescription, and the credits that were held have been returned to your account. Try a clearer picture with better light and send it again.",
  "whatsapp.agent.event.documentFailed":
    "We could not create the file right now. Please ask for it again in a little while.",
  "whatsapp.agent.media.too_large": "That file is a bit too big. Please send a smaller one.",
  "whatsapp.agent.media.unsupported_type":
    "I can only open photos and PDF files. Please send it as a photo or a PDF.",
  "whatsapp.agent.media.download_failed":
    "The picture did not arrive complete. Please send it again.",
  "whatsapp.agent.media.storage_unavailable":
    "I could not save that file right now. Please send it again in a little while.",
  "whatsapp.agent.media.expired": "That file is no longer available. Please send it again.",
  "whatsapp.agent.event.rxPdfName": "prescription-result",
  "document.generatedOn": "Generated on: {date}",
  "document.page": "Page",
  "document.disclaimerTitle": "Medical notice",
  "document.schedule.medicine": "Medicine",
  "document.schedule.dose": "Dose",
  "document.schedule.times": "Times",
  "document.schedule.notes": "Notes",
  "document.rx.title": "Prescription reading result",
  "document.rx.count": "Items: {count}",
  "document.rx.link": "The full result on the platform:",
  "document.rx.name": "Medicine",
  "document.rx.how": "How to take it",
  "document.rx.dose": "Dose",
  "document.rx.frequency": "How often",
  "document.rx.duration": "Duration",
  "document.rx.route": "How to use",
  "document.rx.notes": "Doctor's instructions",
  "document.rx.purpose": "Used for",
  "document.rx.precautions": "Precautions",
  "document.rx.overview": "Summary",
  "document.rx.schedule.title": "Suggested dosing timetable",
  "document.rx.schedule.asNeeded": "As needed",
  "document.rx.schedule.doctor": "As your doctor directs",
  "document.rx.schedule.note":
    "The times are suggested to help you stay on track; follow your doctor's or pharmacist's instructions.",
  "document.rx.schedule.meal.before": "before meals",
  "document.rx.schedule.meal.after": "after meals",
  "document.rx.schedule.meal.with": "with meals",
  "document.rx.schedule.meal.empty_stomach": "on an empty stomach",
  "document.rx.schedule.bedtime": "at bedtime",
  "document.rx.schedule.am": "AM",
  "document.rx.schedule.pm": "PM",
  "document.rx.slot.morning": "Morning",
  "document.rx.slot.noon": "Noon",
  "document.rx.slot.afternoon": "Afternoon",
  "document.rx.slot.evening": "Evening",
  "document.rx.slot.night": "Night",
  "document.rx.slot.bedtime": "Bedtime",
};
