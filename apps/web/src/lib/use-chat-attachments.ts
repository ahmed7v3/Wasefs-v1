"use client";

import { t } from "@wasfa/shared/i18n";
import { CHAT_MAX_IMAGES } from "@wasfa/shared/schemas/chat";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatUploadError, isChatImage, uploadChatImage } from "./chat-upload";

import type { ComposerAttachment } from "@wasfa/ui";

interface Attachment extends ComposerAttachment {
  fileId?: string;
}

/** Pictures attached to the message being written: uploads them as they arrive and tracks their state. */
export function useChatAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const itemsRef = useRef<Attachment[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Leaving the page cancels uploads in flight and frees the local previews.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, []);

  const revoke = (item: Attachment | undefined) => {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  };

  const add = useCallback((files: File[]) => {
    setNotice(null);
    const room = CHAT_MAX_IMAGES - itemsRef.current.length;
    if (files.length > room) setNotice(t("chat.composer.tooMany", { max: CHAT_MAX_IMAGES }));
    for (const file of files.slice(0, Math.max(room, 0))) {
      if (!isChatImage(file)) {
        setNotice(t("chat.composer.unsupported"));
        continue;
      }
      const id = crypto.randomUUID();
      const controller = new AbortController();
      controllers.current.set(id, controller);
      const item: Attachment = {
        id,
        name: file.name || t("chat.message.image"),
        status: "uploading",
        previewUrl: URL.createObjectURL(file),
      };
      itemsRef.current = [...itemsRef.current, item];
      setItems(itemsRef.current);
      uploadChatImage(file, controller.signal).then(
        (fileId) => {
          controllers.current.delete(id);
          setItems((current) =>
            current.map((entry) =>
              entry.id === id ? { ...entry, status: "ready", fileId } : entry,
            ),
          );
        },
        (error: unknown) => {
          controllers.current.delete(id);
          if (controller.signal.aborted) return;
          setNotice(
            error instanceof ChatUploadError && error.reason === "unsupported"
              ? t("chat.composer.unsupported")
              : t("chat.composer.uploadFailed"),
          );
          // A failed picture is dropped: there is nothing to retry from a preview alone.
          setItems((current) => {
            revoke(current.find((entry) => entry.id === id));
            return current.filter((entry) => entry.id !== id);
          });
        },
      );
    }
  }, []);

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setItems((current) => {
      revoke(current.find((entry) => entry.id === id));
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  /** Forgets the attachments after a send (their files now belong to the message). */
  const clear = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    setItems((current) => {
      for (const entry of current) revoke(entry);
      return [];
    });
    setNotice(null);
  }, []);

  return {
    attachments: items as ComposerAttachment[],
    fileIds: items.flatMap((item) => (item.status === "ready" && item.fileId ? [item.fileId] : [])),
    notice,
    add,
    remove,
    clear,
  };
}
