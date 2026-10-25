import {
  activeGrowthRules,
  createOfferFromRule,
  ensureDefaultGrowthRules,
  expireTasteRemainder,
  growthSettingsOf,
  pruneGrowthData,
  silenceMarketing,
  tasteGrantsToSettle,
  unsubscribeToken,
  type Database,
  type GrowthRule,
} from "@wasfa/db";
import { MARKETING_SILENCE_AFTER_LAST_CALL_DAYS, type GrowthMailKind } from "@wasfa/shared/growth";

import {
  claimMail,
  dayOneCandidates,
  dayThreeCandidates,
  lastCallCandidates,
  offersToMail,
  welcomeOfferCandidates,
  winbackCandidates,
  type LifecyclePerson,
  type MailGate,
} from "./growth.repo.js";

import type { JobContext } from "../queues.js";
import type { EmailSendInput } from "@wasfa/shared/email";
import type { JobPayload } from "@wasfa/shared/queues";

/** One run handles at most this many people per step; the next hourly run takes the rest. */
export const GROWTH_BATCH = 200;

type GrowthJobContext = Pick<JobContext, "db" | "logger" | "payments" | "env">;

interface MailRuntime {
  webOrigin: string;
  apiOrigin: string;
  key: Buffer;
  enqueueEmail(payload: EmailSendInput, jobId: string): Promise<void>;
}

const ruleNumber = (rule: GrowthRule, name: string, fallback: number): number => {
  const value = Number((rule.condition as Record<string, unknown>)[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const percentOf = (bps: number) => String(Math.round(bps / 100));

/**
 * Claims the mail (at most once per person, kind and period) and queues it. The unsubscribe link
 * goes to the web confirm page; the one-click header points at the API. Mail only: lifecycle
 * messages never go to WhatsApp (marketing there has no consent and risks the number).
 */
async function sendLifecycleMail(
  db: Database,
  runtime: MailRuntime,
  person: LifecyclePerson,
  kind: GrowthMailKind,
  periodKey: string,
  params: Record<string, string | number>,
  path: string,
  now: Date,
): Promise<boolean> {
  if (!(await claimMail(db, person.id, kind, periodKey, now))) return false;
  const token = unsubscribeToken(runtime.key, person.id);
  await runtime.enqueueEmail(
    {
      template: "lifecycle_mail",
      to: person.email,
      name: person.name,
      locale: person.locale,
      kind,
      params,
      link: `${runtime.webOrigin}${path}`,
      unsubscribeUrl: `${runtime.webOrigin}/unsubscribe?token=${encodeURIComponent(token)}`,
      oneClickUrl: `${runtime.apiOrigin}/unsubscribe?token=${encodeURIComponent(token)}`,
    },
    `lifecycle-${person.id}-${kind}-${periodKey}`.replaceAll(":", "-"),
  );
  return true;
}

/**
 * `growth.lifecycle`, hourly at minute 25 (GROWTH §6): creates the personal offers that their rules
 * call for (welcome on day 6, win-back 3 days after expiry), sends the lifecycle mails to people who
 * opted in (day 1 guide, day 3 value recap, the offer mails, the expiry + 30 last call followed by 90
 * days of silence), and takes back unused taste credits. Every step is idempotent and batched; the
 * kill switch and `lifecycle.enabled` stop all of it.
 */
export async function growthLifecycleJob(
  _payload: JobPayload<"payments", "growth.lifecycle">,
  { db, logger, payments, env }: GrowthJobContext,
  now = new Date(),
): Promise<void> {
  const tastes = await settleTastes(db);
  const settings = await growthSettingsOf(db);
  if (settings.killSwitch || !settings.lifecycle.enabled) {
    if (tastes > 0) logger.info({ tastes }, "Taste credits taken back");
    return;
  }
  await ensureDefaultGrowthRules(db);
  const rules = new Map((await activeGrowthRules(db)).map((rule) => [rule.key, rule]));

  // 1. Offers (in-app; the mail about them is gated separately).
  let offers = 0;
  const welcome = settings.welcomeOffer.enabled ? rules.get("welcome_offer") : undefined;
  if (welcome) {
    const ids = await welcomeOfferCandidates(db, {
      now,
      afterDays: ruleNumber(welcome, "afterDays", 6),
      minAnalyses: ruleNumber(welcome, "minAnalyses", 3),
      limit: GROWTH_BATCH,
    });
    for (const id of ids) if (await createOfferFromRule(db, welcome, id, now)) offers += 1;
  }
  const winback = settings.winback.enabled ? rules.get("winback") : undefined;
  if (winback) {
    const ids = await winbackCandidates(db, {
      now,
      afterExpiryDays: ruleNumber(winback, "afterExpiryDays", 3),
      limit: GROWTH_BATCH,
    });
    for (const id of ids) if (await createOfferFromRule(db, winback, id, now)) offers += 1;
  }

  // 2. Lifecycle mail, only with a configured mail runtime.
  let mails = 0;
  if (payments && env) {
    const runtime: MailRuntime = {
      webOrigin: payments.webOrigin,
      apiOrigin: env.API_PUBLIC_URL.replace(/\/+$/, ""),
      key: Buffer.from(env.ENCRYPTION_KEY, "base64"),
      enqueueEmail: (payload, jobId) => payments.enqueueEmail(payload, jobId),
    };
    const gate: MailGate = {
      now,
      quietHours: settings.marketingMail.quietHoursAfterSignup,
      maxPerWeek: settings.marketingMail.maxPerWeek,
      limit: GROWTH_BATCH,
    };
    if (gate.maxPerWeek > 0) {
      const dateOf = (date: Date) => date.toISOString().slice(0, 10);
      for (const person of await dayOneCandidates(db, gate)) {
        if (
          await sendLifecycleMail(db, runtime, person, "day1_guide", "once", {}, "/analyze", now)
        ) {
          mails += 1;
        }
      }
      for (const person of await dayThreeCandidates(db, gate)) {
        const params = {
          analyses: person.analyses,
          drugs: person.drugs,
          minutes: person.analyses * settings.value.minutesSavedPerAnalysis,
        };
        if (
          await sendLifecycleMail(
            db,
            runtime,
            person,
            "day3_value",
            "once",
            params,
            "/dashboard",
            now,
          )
        ) {
          mails += 1;
        }
      }
      for (const [ruleKey, kind] of [
        ["welcome_offer", "day6_offer"],
        ["winback", "winback"],
      ] as const) {
        for (const offer of await offersToMail(db, { ...gate, ruleKey, kind })) {
          const params = { percent: percentOf(offer.percentBps), date: dateOf(offer.expiresAt) };
          if (
            await sendLifecycleMail(
              db,
              runtime,
              offer,
              kind,
              offer.offerId,
              params,
              "/pricing",
              now,
            )
          ) {
            mails += 1;
          }
        }
      }
      for (const person of await lastCallCandidates(db, gate)) {
        const sent = await sendLifecycleMail(
          db,
          runtime,
          person,
          "last_call",
          person.subscriptionId,
          {},
          "/analyze",
          now,
        );
        if (sent) {
          mails += 1;
          // "then silence for 90 days" (GROWTH §6).
          await silenceMarketing(db, person.id, MARKETING_SILENCE_AFTER_LAST_CALL_DAYS, now);
        }
      }
    }
  }
  if (offers + mails + tastes > 0) logger.info({ offers, mails, tastes }, "Growth lifecycle run");
}

/** Unused taste credits go back (failed or cheaper Deep analyses, tastes that never started). */
async function settleTastes(db: Database): Promise<number> {
  let taken = 0;
  for (const id of await tasteGrantsToSettle(db, new Date())) {
    taken += await expireTasteRemainder(db, id);
  }
  return taken;
}

/** `growth.retention`, nightly at 04:40 UTC: funnel events and the mail log are kept 13 months. */
export async function growthRetentionJob(
  _payload: JobPayload<"payments", "growth.retention">,
  { db, logger }: Pick<JobContext, "db" | "logger">,
  now = new Date(),
): Promise<void> {
  const deleted = await pruneGrowthData(db, now);
  if (deleted.events + deleted.mailLog > 0)
    logger.info(deleted, "Growth data past retention deleted");
}
