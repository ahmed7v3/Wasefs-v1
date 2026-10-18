import type { arReferralsWeb } from "./ar.referrals-web.js";

/** English for the rewards page: keys without an entry fall back to Arabic. */
export const enReferralsWeb: Partial<Record<keyof typeof arReferralsWeb, string>> = {
  "nav.rewards": "Invites and rewards",

  "rewardsPage.title": "Invites and rewards",
  "rewardsPage.lead":
    "Invite your friends and you both earn at every step. Every number here comes from the server.",
  "rewardsPage.disabled":
    "The invite program is paused. Your balance is safe, and no new points are added for now.",
  "rewardsPage.points": "{count} points",
  "rewardsPage.listSeparator": ", ",

  "rewardsPage.hero.title": "Share your link",
  "rewardsPage.hero.you": "You:",
  "rewardsPage.hero.friend": "Your friend:",
  "rewardsPage.hero.noOffers": "No invite rewards are active right now.",
  "rewardsPage.hero.code": "Invite code",
  "rewardsPage.hero.link": "Invite link",
  "rewardsPage.share.whatsapp": "Share on WhatsApp",
  "rewardsPage.share.telegram": "Share on Telegram",
  "rewardsPage.share.message":
    "Try Wasfa AI to read prescriptions and check medicines. Sign up here: {link}",

  "rewardsPage.reward.fixed_points": "{value} points",
  "rewardsPage.reward.fixed_credits": "{value} credits",
  "rewardsPage.reward.percent_of_net_bps": "{value}% of the payment",
  "rewardsPage.offer.referrer.referee_verified": "{reward} when your friend verifies their account",
  "rewardsPage.offer.referrer.first_payment": "{reward} at their first subscription",
  "rewardsPage.offer.referrer.renewal": "{reward} at each of their renewals",
  "rewardsPage.offer.referrer.credit_pack": "{reward} when they buy a credit pack",
  "rewardsPage.offer.referrer.org_member_joined": "{reward} when they join an organization",
  "rewardsPage.offer.referee.referee_verified": "{reward} when they verify their account",
  "rewardsPage.offer.referee.first_payment": "{reward} at the first subscription",
  "rewardsPage.offer.referee.renewal": "{reward} at each renewal",
  "rewardsPage.offer.referee.credit_pack": "{reward} when buying a credit pack",
  "rewardsPage.offer.referee.org_member_joined": "{reward} when joining an organization",
  "rewardsPage.offer.referee.discount": "{percent}% off the first subscription",

  "rewardsPage.balance.title": "Points balance",
  "rewardsPage.balance.cash": "Cash points",
  "rewardsPage.balance.cashValue": "Worth {value}",
  "rewardsPage.balance.creditOnly": "Credit-only points",
  "rewardsPage.balance.creditOnlyNote": "Can only become analysis credits",
  "rewardsPage.balance.pending": "Pending",
  "rewardsPage.balance.pendingIn": "Added within {days} days",
  "rewardsPage.balance.debt":
    "You owe {count} points from refunded rewards. They are taken from your next rewards before they reach your balance.",

  "rewardsPage.convert.open": "Convert to credits",
  "rewardsPage.convert.bonusBadge": "+{percent}% extra credits when converting",
  "rewardsPage.convert.title": "Convert points to credits",
  "rewardsPage.convert.lead":
    "Credit-only points are used first, then cash points. The credits are added to your account as soon as you confirm.",
  "rewardsPage.convert.field": "Points",
  "rewardsPage.convert.available": "Available to convert: {count} points",
  "rewardsPage.convert.invalid": "Enter a whole number of points.",
  "rewardsPage.convert.all": "Convert all points",
  "rewardsPage.convert.calculating": "Calculating…",
  "rewardsPage.convert.rate":
    "Every {rate} points give one credit; the result shows here before you confirm.",
  "rewardsPage.convert.youGet": "You will get {credits} credits",
  "rewardsPage.convert.bonus": "Includes the {percent}% conversion bonus.",
  "rewardsPage.convert.from": "From credit-only points: {creditOnly}, from cash points: {cash}",
  "rewardsPage.convert.previewFailed": "Could not work out the credits now, try again.",
  "rewardsPage.convert.confirm": "Confirm conversion",
  "rewardsPage.convert.done": "{credits} credits were added to your account",

  "rewardsPage.withdraw.open": "Withdraw",
  "rewardsPage.withdraw.progress": "Progress toward the minimum withdrawal",
  "rewardsPage.withdraw.needMore":
    "You need {missing} more cash points to reach the minimum withdrawal ({minimum} points).",
  "rewardsPage.withdraw.off": "Cash withdrawal is not available right now.",
  "rewardsPage.withdraw.soon": "Requesting a cash withdrawal will be available here soon.",

  "rewardsPage.progress.title": "Your progress",
  "rewardsPage.progress.invited": "Signed up",
  "rewardsPage.progress.verified": "Verified",
  "rewardsPage.progress.paid": "Subscribed",
  "rewardsPage.progress.tier": "Your tier:",
  "rewardsPage.progress.noTier": "Just starting",
  "rewardsPage.progress.next":
    '{missing} more subscriptions to reach "{name}" and earn {bonus}% more.',
  "rewardsPage.progress.top": "You reached the top tier.",

  "rewardsPage.activity.title": "Activity",
  "rewardsPage.activity.empty": "No activity yet",
  "rewardsPage.activity.emptyHint":
    "Your points appear here once friends sign up and verify their accounts.",
  "rewardsPage.activity.releaseAt": "Available on {date}",
  "rewardsPage.activity.more": "Show more",
  "rewardsPage.bucket.pending": "Pending",
  "rewardsPage.bucket.cash": "Cash",
  "rewardsPage.bucket.credit_only": "Credit-only",

  "rewardsPage.vanity.open": "Customize code",
  "rewardsPage.vanity.used": "Code customized",
  "rewardsPage.vanity.title": "Customize your invite code",
  "rewardsPage.vanity.lead":
    "Pick a code that is easy to remember: 3 to 20 English letters or digits.",
  "rewardsPage.vanity.field": "New code",
  "rewardsPage.vanity.hint": "English letters and digits only.",
  "rewardsPage.vanity.once": "You can change the code only once, so check it before saving.",
  "rewardsPage.vanity.confirm": "Save code",
  "rewardsPage.vanity.saved": "Your code is now {code}",

  "rewardsPage.how.title": "How it works",
  "rewardsPage.how.verified":
    "An invite counts after your friend verifies their email and phone, and we may ask them to finish a first analysis.",
  "rewardsPage.how.hold":
    "Rewards stay pending for up to {days} days to make sure the payment is not refunded, then they become available.",
  "rewardsPage.how.noHold": "Rewards become available as soon as they are counted.",
  "rewardsPage.how.convert":
    "Every {rate} points become one credit, with an extra {percent}% when you convert.",
  "rewardsPage.how.convertNoBonus": "Every {rate} points become one credit.",
  "rewardsPage.how.withdraw":
    "Only cash points can be withdrawn, from a minimum of {minimum} points and {days} days after you created your account.",
  "rewardsPage.how.withdrawSoon": "Cash withdrawal will be available here soon.",
  "rewardsPage.how.held":
    "We may review a reward before adding it if it looks unusual, such as repeated accounts from the same device.",
  "rewardsPage.how.notMoney":
    "Points are a reward, not money: they cannot be transferred or bought.",

  "rewardsPage.reason.vanity_used":
    "You already customized your code once; it cannot be changed again.",
  "rewardsPage.reason.code_taken": "This code is taken, choose another.",
  "rewardsPage.reason.reserved_code": "This code cannot be used, choose another.",
  "rewardsPage.reason.insufficient_points":
    "Your available points are fewer than the amount asked.",
  "rewardsPage.reason.below_minimum": "This amount is too small to give a whole credit.",
  "rewardsPage.reason.open_reward_debt":
    "You cannot convert now because refunded rewards are taken from your points first.",
  "rewardsPage.reason.idempotency_key_reused":
    "We could not confirm this request, please try again.",
};
