import { Global, Module, type DynamicModule } from "@nestjs/common";

import { AUTH_MAILER } from "../auth/mailer.js";

import { EmailQueue } from "./email-queue.js";
import { MeNotificationPrefsController } from "./me-notification-prefs.controller.js";
import { NotificationPrefsRepo } from "./notification-prefs.repo.js";
import { NotificationPrefsService } from "./notification-prefs.service.js";
import { QueueMailer } from "./queue-mailer.js";

/**
 * Outgoing mail. `EmailQueue` is available everywhere (invites, suspension notices). `authMailer`
 * wires `QueueMailer` as the auth module's `AUTH_MAILER`; tests that capture mail themselves turn it off.
 */
@Global()
@Module({})
export class NotificationsModule {
  static register(options: { authMailer: boolean }): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [MeNotificationPrefsController],
      providers: [
        EmailQueue,
        NotificationPrefsRepo,
        NotificationPrefsService,
        ...(options.authMailer
          ? [QueueMailer, { provide: AUTH_MAILER, useExisting: QueueMailer }]
          : []),
      ],
      exports: [EmailQueue, ...(options.authMailer ? [AUTH_MAILER] : [])],
    };
  }
}
