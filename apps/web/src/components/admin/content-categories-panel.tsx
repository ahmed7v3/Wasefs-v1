"use client";

import { t } from "@wasfa/shared/i18n";
import { categoryListResponseSchema, type Category } from "@wasfa/shared/schemas/content";
import { Badge, Button, Card, EmptyState, useToast } from "@wasfa/ui";
import { ArrowDown, ArrowUp, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { categoryRows, moveSibling, type CategoryRow } from "../../lib/content-taxonomy";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { useContentOptions } from "../../lib/use-content-options";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { CategoryDialog } from "./content-category-dialog";

import type { ApiRequestError } from "../../lib/api-error";

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-lg text-neutral-600 transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40";

/** Categories as an indented two-level tree with keyboard-reachable up/down reordering. */
export function ContentCategoriesPanel({ canManage }: { canManage: boolean }) {
  const resource = useResource("/admin/content/categories", categoryListResponseSchema);
  const options = useContentOptions();
  const reauth = useReauth();
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ category: Category | null } | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [moveError, setMoveError] = useState<ApiRequestError | null>(null);
  const [moving, setMoving] = useState(false);

  if (resource.status === "loading") {
    return <p role="status">{t("ui.loading")}</p>;
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }

  const categories = resource.data.items;
  const rows = categoryRows(categories);

  const move = (row: CategoryRow, direction: "up" | "down") => {
    if (moving) return;
    setMoving(true);
    setMoveError(null);
    const ids = moveSibling(row.siblings, row.category.id, direction);
    reauth
      .run(() =>
        api("/admin/content/categories/reorder", {
          method: "POST",
          body: { parentId: row.category.parentId, ids },
          schema: categoryListResponseSchema,
        }),
      )
      .then(
        () => {
          setMoving(false);
          resource.reload();
        },
        (failure: unknown) => {
          setMoving(false);
          setMoveError(toApiError(failure));
        },
      );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{t("admin.content.category.treeHint")}</p>
        {canManage ? (
          <Button
            onClick={() => {
              setEditing({ category: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.content.category.new")}
          </Button>
        ) : null}
      </div>

      {moveError ? <ErrorNotice error={moveError} /> : null}

      {rows.length === 0 ? (
        <Card elevation="flat">
          <EmptyState
            icon={<FolderTree />}
            title={t("admin.content.category.empty")}
            description={t("admin.content.category.emptyHint")}
          />
        </Card>
      ) : (
        <Card elevation="flat" padding="none">
          <ul className="divide-y divide-border" aria-label={t("admin.content.tab.categories")}>
            {rows.map((row) => {
              const { category } = row;
              return (
                <li
                  key={category.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
                  style={{ paddingInlineStart: row.depth === 1 ? "3rem" : undefined }}
                >
                  <div className="flex min-w-0 flex-1 basis-56 flex-col">
                    <span className="break-words font-semibold text-text">{category.nameAr}</span>
                    <bdi dir="ltr" className="text-start text-sm text-text-muted">
                      {category.slugAr}
                    </bdi>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">
                      {t("admin.content.itemCount", { count: category.itemCount })}
                    </Badge>
                    {category.requiresMedicalReview ? (
                      <Badge tone="info">{t("admin.content.category.reviewBadge")}</Badge>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex items-center">
                      <button
                        type="button"
                        className={iconButton}
                        disabled={row.index === 0 || moving}
                        aria-label={t("admin.content.category.moveUp", { name: category.nameAr })}
                        onClick={() => {
                          move(row, "up");
                        }}
                      >
                        <ArrowUp aria-hidden className="size-5" />
                      </button>
                      <button
                        type="button"
                        className={iconButton}
                        disabled={row.index === row.siblings.length - 1 || moving}
                        aria-label={t("admin.content.category.moveDown", { name: category.nameAr })}
                        onClick={() => {
                          move(row, "down");
                        }}
                      >
                        <ArrowDown aria-hidden className="size-5" />
                      </button>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label={t("admin.content.edit", { name: category.nameAr })}
                        onClick={() => {
                          setEditing({ category });
                        }}
                      >
                        <Pencil aria-hidden className="size-5" />
                      </button>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label={t("admin.content.delete", { name: category.nameAr })}
                        onClick={() => {
                          setDeleting(category);
                        }}
                      >
                        <Trash2 aria-hidden className="size-5 text-danger" />
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <CategoryDialog
        open={editing !== null}
        category={editing?.category ?? null}
        categories={categories}
        options={options.status === "ready" ? options.data : null}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={resource.reload}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("admin.content.category.deleteTitle", { name: deleting?.nameAr ?? "" })}
        description={t("admin.content.category.deleteBody")}
        confirmLabel={t("admin.content.deleteVerb")}
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await api(`/admin/content/categories/${deleting.id}`, { method: "DELETE" });
          toast({ tone: "success", title: t("admin.content.taxonomy.deleted") });
          resource.reload();
        }}
      />
    </div>
  );
}
