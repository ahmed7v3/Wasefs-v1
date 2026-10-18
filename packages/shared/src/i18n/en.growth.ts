import type { arGrowth } from "./ar.growth.js";

/** English strings of the conversion engine; the keys mirror `ar.growth.ts`, the Arabic source. */
export const enGrowth: Record<keyof typeof arGrowth, string> = {
  "growth.prompt.analysis_taste.a":
    "We analysed your prescription. {count} items need a closer look. Deep analysis reviews them more precisely; try it free this time.",
  "growth.prompt.analysis_taste.b":
    "Your prescription has {count} uncertain items. Try deep analysis on them free, once this week.",
  "growth.prompt.credits_low.a": "You have used {used} of {total} credits this month.",
  "growth.prompt.credits_low.b": "You have {left} of {total} credits left this month.",
  "growth.prompt.credits_out.a":
    "Your free credits are used up. They renew on {date}, or you can buy extra credits now.",
  "growth.prompt.credits_out.b": "Your credits renew on {date}. If you need some sooner, you can buy extra credits.",
  "growth.prompt.locked_feature.deep.a":
    "Deep analysis reviews uncertain items more precisely. It is part of the paid plans.",
  "growth.prompt.locked_feature.web_search.a":
    "Web search adds recent sources to the assistant's answers. It is part of the paid plans.",
  "growth.prompt.org_usage.a":
    "Your team ran {analyses} analyses this month. The Clinic plan is built for teams and lowers the cost per analysis.",
  "growth.prompt.expiring_free_credits.a": "You have {credits} credits that expire in {days} days.",
  "growth.prompt.plan_expiring.a": "Your plan ends in {days} days. Renew in one tap.",
  "growth.cta.taste": "Try deep analysis free",
  "growth.cta.pricing": "See the plans",
  "growth.cta.pack": "Buy extra credits",
  "growth.cta.renew": "Renew now",
  "growth.cta.analyze": "Analyse a prescription now",
  "growth.cta.dismiss": "Not now",
  "growth.prompt.closeLabel": "Close suggestion",

  "growth.taste.title": "Deep analysis next to the first analysis",
  "growth.taste.running": "Reading the same prescription again with deep analysis…",
  "growth.taste.improved": "Item {index}: was “{before}”, now “{after}”",
  "growth.taste.same": "This item did not change",
  "growth.taste.summary": "{improved} of {total} items improved.",
  "growth.taste.after": "Deep analysis is part of the {plan} plan for {price}.",
  "growth.taste.refusal.not_eligible": "The free try is available once a week to verified free accounts.",
  "growth.taste.refusal.weekly_limit": "You have used this week's free try.",
  "growth.taste.refusal.budget": "Free tries are paused for now. Please try later.",
  "growth.taste.before": "First analysis",
  "growth.taste.deep": "Deep analysis",
  "growth.taste.improvedLabel": "Improved",
  "growth.taste.afterCalm": "Deep analysis is part of the paid plans, if you need it.",

  "growth.value.title": "What Wasfa has done for you",
  "growth.value.analyses": "{count} prescriptions analysed",
  "growth.value.drugs": "{count} medicines checked",
  "growth.value.minutes": "≈ {hours} hours saved (estimate)",
  "growth.value.estimateNote": "Time saved is a rough estimate based on the number of analyses.",
  "growth.proof.analysesThisWeek": "{count} prescriptions analysed this week",
  "growth.proof.mostChosen": "Most chosen",
  "growth.offer.title": "An offer for you",
  "growth.offer.endsAt": "Ends on {date}",
  "growth.offer.percent": "{percent}% off a subscription",

  "email.lifecycle.unsubscribe": "Unsubscribe from these emails",
  "email.lifecycle.day1_guide.subject": "Getting started? Here is the best way to take the photo",
  "email.lifecycle.day1_guide.body":
    "For the best reading: good light, the paper flat and fully in the frame, no shadow or glare. The first analysis takes about a minute.",
  "email.lifecycle.day1_guide.button": "Upload your first prescription",
  "email.lifecycle.day3_value.subject": "What you have got so far",
  "email.lifecycle.day3_value.body":
    "You analysed {analyses} prescriptions and checked {drugs} medicines, saving about {minutes} minutes (a rough estimate).",
  "email.lifecycle.day3_value.button": "Open your dashboard",
  "email.lifecycle.day6_offer.subject": "An offer for you: {percent}% off the first month",
  "email.lifecycle.day6_offer.body":
    "Thank you for using Wasfa. You have {percent}% off the first month of any plan, valid until {date}. No automatic renewal.",
  "email.lifecycle.day6_offer.button": "See the offer",
  "email.lifecycle.winback.subject": "We keep your history. Come back any time",
  "email.lifecycle.winback.body":
    "Your plan has ended and your history is kept as it is. If you want to come back, you have {percent}% off until {date}.",
  "email.lifecycle.winback.button": "Back to Wasfa",
  "email.lifecycle.last_call.subject": "Your Wasfa history is still here",
  "email.lifecycle.last_call.body":
    "This is our last message for a while. Your free account works, and your monthly credits renew whenever you need them.",
  "email.lifecycle.last_call.button": "Analyse a prescription",
  "email.lifecycle.value_recap.subject": "Your month in Wasfa",
  "email.lifecycle.value_recap.body":
    "This month you analysed {analyses} prescriptions and checked {drugs} medicines, saving about {minutes} minutes (a rough estimate).",
  "email.lifecycle.value_recap.button": "Open your dashboard",

  "growth.unsubscribe.pageTitle": "Stop tips and offers",
  "growth.unsubscribe.lead": "Press the button to stop tips and offers. Important account and payment emails still arrive as usual.",
  "growth.unsubscribe.confirm": "Stop these emails",
  "growth.unsubscribe.title": "You are unsubscribed",
  "growth.unsubscribe.body":
    "You will no longer get tips and offers. Important account and payment emails still arrive as usual. You can turn them back on from your account page.",
  "growth.unsubscribe.invalid": "This link is not valid.",
  "growth.consent.label": "Email me usage tips and offers (at most one email a week)",
  "growth.consent.accountLabel": "Tips and offers by email",
  "growth.consent.accountHint": "At most one email a week; unsubscribe in one click from any of them.",
};
