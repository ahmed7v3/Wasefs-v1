import type { arMessaging } from "./ar.messaging.js";

/** English counterpart of `ar.messaging.ts` (server-sent texts: WhatsApp follow-ups, document labels). */
export const enMessaging: Partial<Record<keyof typeof arMessaging, string>> = {
  "whatsapp.agent.deferred": "Sorry, I will get back to you in a few minutes 🙏",
  "whatsapp.agent.failed":
    "Something went wrong on our side and I could not reply right now. If it keeps happening, send this code to customer service: {ref}",
  "whatsapp.agent.aiPaused":
    "The smart assistant is paused for now. We will reply as soon as it is back 🙏",
  "whatsapp.agent.fallback.ack": "Got it. What else do you need from me?",
  "whatsapp.agent.fallback.analyze_prescription":
    "⏳ I am reading the prescription now, the result will reach you within a minute",
  "whatsapp.agent.fallback.start_subscription":
    "Your order {orderRef} is open. Amount: {amount}\nTransfer to: {bank}\nAccount name: {holder}\nAccount: {account}\nReference: {reference}",
  "whatsapp.agent.fallback.start_subscription.free":
    "Your order {orderRef} is active, nothing to pay.",
  "whatsapp.agent.fallback.offer_discount": "Your discount code: {code}, valid until {expires}",
  "whatsapp.agent.fallback.create_document":
    "I am preparing your file and it will reach you shortly",
  "whatsapp.agent.fallback.handoff_to_owner":
    "I passed your message to my colleague and they will reply",
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
  "whatsapp.agent.event.rxFailed.unreadable_image":
    "The picture is not clear enough for me to read. Please take it in good light, from above, and send it again.",
  "whatsapp.agent.event.rxFailed.not_a_prescription":
    "That does not look like a prescription. Please send a picture of the prescription itself.",
  "whatsapp.agent.event.rxFailed.too_many_pages":
    "The prescription has more pages than allowed. Please send it in smaller parts.",
  "whatsapp.agent.event.rxFailed.insufficient_credits":
    "Your balance is not enough to read this prescription. Top up or pick a plan on the website, then send it again.",
  "whatsapp.agent.event.rxFailed.model_unavailable":
    "The service is busy and we could not read the prescription. Please send it again in a little while.",
  "whatsapp.agent.event.rxFailed.internal":
    "Something went wrong on our side and we could not read the prescription. Please send it again in a little while.",
  "whatsapp.agent.event.rxFailed.creditsReturned": "Your credits have been returned.",
  "whatsapp.agent.event.rxFailed.creditsNotReturned":
    "If any credit was deducted, it will be returned automatically.",
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
  "whatsapp.agent.session.returning":
    "A returning customer after a break; start fresh and do not assume old context.",
  "whatsapp.agent.rx.fromEarlier": "The result of the prescription you sent at {time}:",
  "whatsapp.agent.rx.starting":
    "⏳ Reading the prescription ({pages})… the result will reach you in under a minute",
  "whatsapp.agent.rx.pages.one": "1 page",
  "whatsapp.agent.rx.pages.two": "2 pages",
  "whatsapp.agent.rx.pages.many": "{count} pages",
  "whatsapp.agent.attachments.header": "Attachments in this conversation:",
  "whatsapp.agent.attachments.hint":
    "To read a prescription use analyze_prescription with the set or the attachment handles. If the customer asks about a specific picture use view_attachment.",
  "whatsapp.agent.attachments.kind.image": "picture",
  "whatsapp.agent.attachments.kind.pdf": "PDF",
  "whatsapp.agent.attachments.kind.document": "file",
  "whatsapp.agent.attachments.age.now": "just now",
  "whatsapp.agent.attachments.age.minutes": "{n} min ago",
  "whatsapp.agent.attachments.age.hours": "{n} h ago",
  "whatsapp.agent.attachments.age.days": "{n} d ago",
  "whatsapp.agent.attachments.status.ready": "ready",
  "whatsapp.agent.attachments.status.failed": "failed ({reason})",
  "whatsapp.agent.attachments.status.expired": "deleted",
  "whatsapp.agent.attachments.status.analysed": "analysed (rx#{ref})",
  "whatsapp.agent.attachments.status.in_progress": "being analysed (rx#{ref})",
  "whatsapp.agent.attachments.set": "set {label}",
  "whatsapp.agent.attachments.imageRow": "[picture #{handle}]",
  "whatsapp.agent.attachments.fileRow": "[file #{handle}]",
  "whatsapp.agent.toolNote": "[tool: {body}]",
  "whatsapp.agent.tools.viewCaption": "[Picture #{handle} as you asked to see it]",
  "whatsapp.agent.tools.explain.not_linked":
    "This service is for confirmed accounts only, and this number is not linked to one.",
  "whatsapp.agent.tools.explain.already_linked": "This number is already linked to an account.",
  "whatsapp.agent.tools.explain.invalid_arguments":
    "The request was incomplete or malformed; try again with the right details.",
  "whatsapp.agent.tools.explain.tool_failed":
    "The tool had a temporary problem and nothing changed; we can try again shortly.",
  "whatsapp.agent.tools.explain.stale_turn":
    "A newer message arrived, so this request was cancelled with no change.",
  "whatsapp.agent.tools.explain.no_image":
    "There is no prescription picture ready to read. Ask the customer to send the prescription.",
  "whatsapp.agent.tools.explain.still_processing":
    "The file is still being prepared. Try again in a moment.",
  "whatsapp.agent.tools.explain.unreadable_image":
    "The picture is unclear or damaged. Ask the customer for a clearer one.",
  "whatsapp.agent.tools.explain.already_analysed":
    "That prescription was already read; the result was sent in an earlier message.",
  "whatsapp.agent.tools.explain.insufficient_credits":
    "The customer's balance is not enough for this. Offer a top-up or a plan.",
  "whatsapp.agent.tools.explain.quota_reached": "The customer reached their limit for this period.",
  "whatsapp.agent.tools.explain.plan_feature":
    "This service is not part of the customer's current plan.",
  "whatsapp.agent.tools.explain.too_many_pages":
    "There are more pages than one prescription allows.",
  "whatsapp.agent.tools.explain.account_unavailable":
    "The customer's account cannot do this right now.",
  "whatsapp.agent.tools.explain.busy": "The service is busy right now. Try again shortly.",
  "whatsapp.agent.tools.explain.unavailable":
    "The service is temporarily unavailable. Try again shortly.",
  "whatsapp.agent.tools.explain.unknown_handle":
    "That attachment number or set is not in the current conversation. Check the attachments list.",
  "whatsapp.agent.tools.explain.not_ready":
    "That attachment is not ready: still preparing, failed to download, or deleted. Ask the customer to resend if needed.",
  "whatsapp.agent.tools.explain.unknown_key": "The requested file is not in the library.",
  "whatsapp.agent.tools.explain.limit_reached": "The limit for this message or period was reached.",
  "whatsapp.agent.tools.explain.media_unavailable": "That file cannot be sent right now.",
  "whatsapp.agent.tools.explain.disabled": "Offers are switched off right now.",
  "whatsapp.agent.tools.explain.plan_not_found":
    "The requested plan does not exist or is not available.",
  "whatsapp.agent.tools.explain.plan_not_allowed": "There is no discount offer on that plan.",
  "whatsapp.agent.tools.explain.not_new_customer": "This discount is for new customers only.",
  "whatsapp.agent.tools.explain.too_early": "It is too early for a discount offer; try later.",
  "whatsapp.agent.tools.explain.price_unavailable":
    "The price is not available right now. Try again shortly.",
  "whatsapp.agent.tools.explain.no_better_price":
    "The discount would not save the customer anything over the current price.",
  "whatsapp.agent.tools.explain.lifetime_limit":
    "The customer already used the discount offers available to them.",
  "whatsapp.agent.tools.explain.daily_cap": "The daily limit of discount offers was reached.",
  "whatsapp.agent.tools.explain.no_bank_method": "Bank transfer is not available right now.",
  "whatsapp.agent.tools.explain.coupon_unavailable": "The coupon code is invalid or expired.",
  "whatsapp.agent.tools.explain.quote_expired":
    "The quoted price expired. Ask for the offer again.",
  "whatsapp.agent.tools.explain.order_failed": "The order could not be opened. Try again shortly.",
  "whatsapp.agent.tools.explain.no_receipt_found":
    "There is no receipt picture ready. Ask the customer to send it.",
  "whatsapp.agent.tools.explain.no_pending_payment": "There is no order waiting for payment.",
  "whatsapp.agent.tools.explain.unreadable_receipt":
    "The receipt picture is unclear. Ask for a clearer one.",
  "whatsapp.agent.tools.explain.proof_limit":
    "The maximum number of receipts for this order was reached.",
  "whatsapp.agent.tools.explain.proof_not_allowed":
    "This order does not accept receipts right now.",
  "whatsapp.agent.tools.explain.rate_limited":
    "Too many attempts in a short time. Wait a little and try again.",
  "whatsapp.agent.tools.explain.attach_failed":
    "The receipt could not be attached. Try again shortly.",
  "whatsapp.agent.tools.explain.not_deliverable":
    "The medical answer could not be delivered and nothing was charged. Try again shortly.",
  "whatsapp.agent.tools.explain.needs_confirmation": "The customer must agree explicitly first.",
  "whatsapp.agent.tools.explain.phone_unknown":
    "We cannot see the customer's number, so sign-up must be done on the website.",
  "whatsapp.agent.tools.explain.signup_closed": "Sign-up is paused for now.",
  "whatsapp.agent.tools.explain.exists":
    "This number already has an account. Offer a sign-in link.",
  "whatsapp.agent.tools.explain.inactive":
    "A sign-in link is not available for this account. Ask them to sign in on the website.",
  "whatsapp.agent.tools.explain.two_factor":
    "A sign-in link is not available for this account. Ask them to sign in on the website.",
  "whatsapp.agent.tools.explain.privileged":
    "A sign-in link is not available for this account. Ask them to sign in on the website.",
  "whatsapp.agent.tools.explain.view_limit": "You can look at two pictures per reply only.",
  "whatsapp.agent.tools.explain.view_unavailable": "I cannot show that attachment right now.",
  "whatsapp.agent.commands.new":
    'We started a fresh page 👋\n• Send me a photo of the prescription and I will read it\n• Ask me about any medicine\n• Type "help" to see the menu',
  "whatsapp.agent.commands.help.header": "I can help you with:",
  "whatsapp.agent.commands.help.footer":
    "Type the number of your choice within 10 minutes, or just ask me in your own words.",
  "whatsapp.agent.commands.menu.analyze": "Read a prescription",
  "whatsapp.agent.commands.menu.report": "Resend the prescription report",
  "whatsapp.agent.commands.menu.balance": "My balance and plan",
  "whatsapp.agent.commands.menu.schedule": "Medicine schedule",
  "whatsapp.agent.commands.menu.voice": "Voice replies (on or off)",
  "whatsapp.agent.commands.menu.lang": "Change language",
  "whatsapp.agent.commands.menu.human": "Talk to a person",
  "whatsapp.agent.commands.menu.new": "Start a new conversation",
  "whatsapp.agent.commands.menu.privacy": "Delete this chat's data",
  "whatsapp.agent.commands.guest":
    'That is for account holders. To open an account, write "I want an account" and I will help you right here 🙂',
  "whatsapp.agent.commands.analyze.awaiting":
    "Send a photo of the prescription and I will read it right away",
  "whatsapp.agent.commands.analyze.notReady":
    "The picture is not ready or did not arrive completely. Please send it again.",
  "whatsapp.agent.commands.analyze.alreadyAnalysed":
    "That prescription was already read, the result is in the message above.",
  "whatsapp.agent.commands.analyze.stillProcessing":
    'The picture is still being prepared. Write "analyze" again in a moment.',
  "whatsapp.agent.commands.analyze.failed":
    "I could not start reading the prescription right now and nothing was charged. Please try again shortly.",
  "whatsapp.agent.commands.balance.header": "📊 Your account",
  "whatsapp.agent.commands.balance.plan": "• Plan: {plan}",
  "whatsapp.agent.commands.balance.credits": "• Credits: {balance}",
  "whatsapp.agent.commands.balance.renews": "• Renews on: {date}",
  "whatsapp.agent.commands.balance.ends": "• Ends on: {date}",
  "whatsapp.agent.commands.balance.nextGrant": "• Next monthly credits on: {date}",
  "whatsapp.agent.commands.balance.pending": "• Order waiting for payment: {number}",
  "whatsapp.agent.commands.report.none": "There is no report yet",
  "whatsapp.agent.commands.voice.on": "Done, voice replies are available again 🎙️",
  "whatsapp.agent.commands.voice.off": "Done, I will reply in writing from now on",
  "whatsapp.agent.commands.lang.ar": "تمام، هكلمك بالعربي 👍",
  "whatsapp.agent.commands.lang.en": "Sure, I will reply in English from now on 👍",
  "whatsapp.agent.commands.privacy.ask":
    'Write "confirm" within 5 minutes and I will delete this chat\'s data',
  "whatsapp.agent.commands.privacy.done": "This chat's data was deleted.",
  "whatsapp.agent.commands.soon": "Coming soon 🙂",
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
