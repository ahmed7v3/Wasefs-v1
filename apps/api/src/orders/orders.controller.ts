import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { createOrderSchema, orderIdParamSchema } from "@wasfa/shared/schemas/billing";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { OrdersService } from "./orders.service.js";

class CreateOrderDto extends createZodDto(createOrderSchema) {}
class OrderIdParamDto extends createZodDto(orderIdParamSchema) {}

/** The caller's own orders. Someone else's order answers `NOT_FOUND`, never `FORBIDDEN`. */
@Controller("billing/orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @RateLimit(10)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateOrderDto) {
    return this.orders.create(user.id, body);
  }

  @Get(":id")
  @RateLimit(120)
  status(@CurrentUser() user: AuthenticatedUser, @Param() params: OrderIdParamDto) {
    return this.orders.status(user.id, params.id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RateLimit(10)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param() params: OrderIdParamDto) {
    return this.orders.cancel(user.id, params.id);
  }
}
