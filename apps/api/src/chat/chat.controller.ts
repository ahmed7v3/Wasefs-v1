import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  chatListQuerySchema,
  chatMessagesQuerySchema,
  createChatSchema,
  sendMessageSchema,
  updateChatSchema,
} from "@wasfa/shared/schemas/chat";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { ErrorReporter } from "../common/errors.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { RequireVerified } from "../common/verified.guard.js";

import { ChatTurnService } from "./chat-turn.service.js";
import { ChatService } from "./chat.service.js";
import { SseStream, type ChatStreamIo } from "./sse.js";

import type { ErrorCode } from "@wasfa/shared/errors";
import type { FastifyReply, FastifyRequest } from "fastify";

class CreateChatDto extends createZodDto(createChatSchema) {}
class UpdateChatDto extends createZodDto(updateChatSchema) {}
class ChatListQueryDto extends createZodDto(chatListQuerySchema) {}
class MessagesQueryDto extends createZodDto(chatMessagesQuerySchema) {}
class SendMessageDto extends createZodDto(sendMessageSchema) {}
class ChatIdParamDto extends createZodDto(idParamSchema) {}

/** Interval of the heartbeat; overridable in tests through `CHAT_HEARTBEAT_MS_TOKEN`. */
export const CHAT_HEARTBEAT_MS_TOKEN = Symbol("CHAT_HEARTBEAT_MS");

/**
 * The `/ai` assistant. Tool routes: a verified, onboarded account. Chats are personal, so every
 * route is scoped to the caller and a foreign chat id answers `NOT_FOUND`.
 */
@Controller("ai/chats")
@RequireVerified()
export class ChatController {
  constructor(
    private readonly chats: ChatService,
    private readonly turns: ChatTurnService,
    private readonly reporter: ErrorReporter,
    @Inject(CHAT_HEARTBEAT_MS_TOKEN) private readonly heartbeatMs: number,
  ) {}

  @Post()
  @RateLimit(30)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateChatDto) {
    return this.chats.create(user.id, body);
  }

  @Get()
  @RateLimit(120)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ChatListQueryDto) {
    return this.chats.list(user.id, query);
  }

  @Get(":id")
  @RateLimit(120)
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: ChatIdParamDto) {
    return this.chats.get(user.id, params.id);
  }

  @Patch(":id")
  @RateLimit(60)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ChatIdParamDto,
    @Body() body: UpdateChatDto,
  ) {
    return this.chats.update(user.id, params.id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RateLimit(60)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() params: ChatIdParamDto) {
    await this.chats.remove(user.id, params.id);
  }

  @Get(":id/messages")
  @RateLimit(120)
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ChatIdParamDto,
    @Query() query: MessagesQueryDto,
  ) {
    return this.chats.messages(user.id, params.id, query);
  }

  /**
   * Answers over `text/event-stream`. Refusals before the stream opens (plan, quota, kill switch,
   * credits, busy) are the usual JSON errors; once it is open, problems arrive as `error` events.
   */
  @Post(":id/messages")
  @HttpCode(200)
  @RateLimit(30)
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ChatIdParamDto,
    @Body() body: SendMessageDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const abort = new AbortController();
    const stream = new SseStream(reply.raw, this.heartbeatMs);
    // `close` also fires after a normal end; only a response that never finished means the client left.
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) abort.abort();
      stream.end();
    });
    const io: ChatStreamIo = {
      open: () => {
        if (stream.isOpen) return;
        // The response is ours from here: Fastify must not send anything of its own.
        reply.hijack();
        stream.start({
          ...(reply.getHeaders() as Record<string, string | number | string[]>),
          "x-request-id": String(request.id),
        });
      },
      send: (event) => {
        stream.send(event);
      },
      close: () => {
        stream.end();
      },
      signal: abort.signal,
      report: (error: unknown, code: ErrorCode) => this.reporter.report(error, request, code),
    };
    await this.turns.send(user, params.id, body, io);
  }
}
