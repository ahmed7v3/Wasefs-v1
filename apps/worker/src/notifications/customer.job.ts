import {
  checkCustomerWhatsapp,
  deliverCustomerMessage,
  type CustomerChannelDeps,
} from "./customer-channel.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

function channelDeps({ db, redis, logger, payments }: JobContext): CustomerChannelDeps {
  if (!payments) throw new Error("payments_runtime_missing");
  return {
    db,
    redis,
    logger,
    webOrigin: payments.webOrigin,
    enqueueEmail: (payload, jobId) => payments.enqueueEmail(payload, jobId),
    defer: (payload, delayMs, jobId) => payments.enqueueCustomerMessage(payload, jobId, delayMs),
    scheduleCheck: (payload, delayMs, jobId) =>
      payments.enqueueCustomerCheck(payload, delayMs, jobId),
  };
}

/** `customer.notify`: WhatsApp when the customer can get it there, else email. */
export async function customerNotifyJob(
  payload: JobPayload<"notifications", "customer.notify">,
  context: JobContext,
): Promise<void> {
  const outcome = await deliverCustomerMessage(payload, channelDeps(context));
  context.logger.info({ kind: payload.kind, outcome }, "Customer notification routed");
}

/** `customer.whatsapp_check`: the email goes when the bridge did not confirm the WhatsApp send. */
export async function customerWhatsappCheckJob(
  payload: JobPayload<"notifications", "customer.whatsapp_check">,
  context: JobContext,
): Promise<void> {
  await checkCustomerWhatsapp(payload, channelDeps(context));
}
