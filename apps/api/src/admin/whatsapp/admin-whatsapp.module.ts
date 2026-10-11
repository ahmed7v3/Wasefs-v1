import { Module } from "@nestjs/common";

import { PhoneModule } from "../../phone/phone.module.js";

import { AdminWhatsappController } from "./admin-whatsapp.controller.js";
import { AdminWhatsappService } from "./admin-whatsapp.service.js";

/** Link, monitor and unlink the WhatsApp verification number (`/admin/whatsapp`). */
@Module({
  imports: [PhoneModule],
  controllers: [AdminWhatsappController],
  providers: [AdminWhatsappService],
})
export class AdminWhatsappModule {}
