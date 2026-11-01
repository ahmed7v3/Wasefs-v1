import { t } from "@wasfa/shared/i18n";

import { composeParts } from "../../compose/compose-parts.js";
import { say, type CommandHandler } from "../command-types.js";

import { linkedUser } from "./shared.js";

/** Orders listed in the balance message: the newest few are enough. */
const PENDING_SHOWN = 3;

const dayOf = (iso: string): string => iso.slice(0, 10);

/** `balance`: the same facts as the `account_status` tool, as a short fixed message. */
export const balanceHandler: CommandHandler = async (input, deps) => {
  const user = linkedUser(input);
  if ("guest" in user) return user.guest;
  const { locale, config } = input;
  const facts = await deps.account.status(user.userId, input.now);
  const lines = [
    t("whatsapp.agent.commands.balance.header", undefined, locale),
    t("whatsapp.agent.commands.balance.plan", { plan: facts.plan.name }, locale),
    t(
      "whatsapp.agent.commands.balance.credits",
      { balance: String(facts.credits.balance) },
      locale,
    ),
  ];
  const { subscription } = facts;
  if (subscription !== null) {
    lines.push(
      t(
        subscription.cancelAtPeriodEnd
          ? "whatsapp.agent.commands.balance.ends"
          : "whatsapp.agent.commands.balance.renews",
        { date: dayOf(subscription.endsAt) },
        locale,
      ),
    );
  }
  if (facts.credits.monthlyCredits > 0) {
    lines.push(
      t(
        "whatsapp.agent.commands.balance.nextGrant",
        { date: dayOf(facts.credits.nextGrantAt) },
        locale,
      ),
    );
  }
  for (const order of facts.pendingOrders.slice(0, PENDING_SHOWN)) {
    lines.push(t("whatsapp.agent.commands.balance.pending", { number: order.number }, locale));
  }
  return { parts: composeParts(lines.join("\n"), config.caps) };
};

/** `report`: the last analysis report PDF this chat received, sent again; none yet gets a plain line. */
export const reportHandler: CommandHandler = async (input, deps) => {
  const user = linkedUser(input);
  if ("guest" in user) return user.guest;
  // The deliverer names the file after the chat's language of the time, so both names are looked up.
  const names = (["ar", "en"] as const).map(
    (locale) => `${t("whatsapp.agent.event.rxPdfName", {}, locale)}.pdf`,
  );
  const found = await deps.store.lastReport(input.conversation.id, names);
  if (found === null) return { parts: say(input, "whatsapp.agent.commands.report.none") };
  return { parts: [{ kind: "document", mediaKey: found.mediaKey, fileName: found.fileName }] };
};
