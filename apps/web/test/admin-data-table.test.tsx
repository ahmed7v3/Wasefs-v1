// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { adminUserListResponseSchema, type AdminUser } from "@wasfa/shared/schemas/admin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataTable, type DataTableColumn } from "../src/components/admin/data-table";
import { FilterBar, SEARCH_DEBOUNCE_MS } from "../src/components/admin/filter-bar";
import { buildQuery, useCursorList } from "../src/lib/use-admin-data";

let search = "";
const replace = vi.fn<(url: string, options?: unknown) => void>();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams(search),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function user(index: number): AdminUser {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `User ${index}`,
    email: `user${index}@example.com`,
    phone: null,
    emailVerified: true,
    phoneVerified: false,
    status: "active",
    roles: [],
    accountType: "individual",
    image: null,
    providers: ["credential"],
    twoFactorEnabled: false,
    createdAt: "2026-10-01T10:00:00.000Z",
    lastLoginAt: null,
  };
}

const columns: DataTableColumn<AdminUser>[] = [
  { id: "name", header: "Name", primary: true, cell: (row) => row.name },
  { id: "email", header: "Email", cell: (row) => row.email ?? "—" },
];

function Harness({ query }: { query: string }) {
  const list = useCursorList("/admin/users", query, adminUserListResponseSchema);
  return (
    <DataTable
      caption="users"
      columns={columns}
      rows={list.items}
      rowKey={(row) => row.id}
      status={list.status}
      error={list.error}
      onRetry={list.reload}
      nextCursor={list.nextCursor}
      loadingMore={list.loadingMore}
      loadMoreError={list.loadMoreError}
      onLoadMore={list.loadMore}
      emptyTitle="No users"
    />
  );
}

beforeEach(() => {
  search = "";
  replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildQuery", () => {
  it("leaves out empty filters", () => {
    expect(buildQuery({ q: "sara", status: "", role: undefined })).toBe("q=sara");
  });
});

describe("DataTable with useCursorList", () => {
  it("loads the next page with the cursor and the same filters, and appends it", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [user(1), user(2)], nextCursor: "cursor_1" }))
      .mockResolvedValueOnce(json({ items: [user(3)], nextCursor: null }));
    render(<Harness query="q=user&status=active" />);

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstUrl).toMatch(/\/admin\/users\?q=user&status=active$/);

    await userEvent.click(screen.getByRole("button", { name: t("admin.table.loadMore") }));
    await waitFor(() => {
      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
    });
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondUrl).toMatch(/\/admin\/users\?q=user&status=active&cursor=cursor_1$/);
    // Last page: no more button.
    expect(screen.queryByRole("button", { name: t("admin.table.loadMore") })).toBeNull();
  });

  it("starts over from the first page when the filters change", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [user(1)], nextCursor: "cursor_1" }))
      .mockResolvedValueOnce(json({ items: [user(9)], nextCursor: null }));
    const view = render(<Harness query="q=a" />);
    await screen.findByRole("table");
    view.rerender(<Harness query="q=b" />);
    await waitFor(() => {
      expect(within(screen.getByRole("table")).getByText("User 9")).toBeTruthy();
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\?q=b$/);
    expect(within(screen.getByRole("table")).queryByText("User 1")).toBeNull();
  });

  it("shows the friendly error with a retry, and the empty state with clear filters", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ code: "INTERNAL", message: "x", ref: "WSF-ABCD-2345" }, 500),
    );
    render(<Harness query="" />);
    expect(await screen.findByText(t("error.INTERNAL"))).toBeTruthy();
    expect(screen.getByText(t("common.errorRef", { ref: "WSF-ABCD-2345" }))).toBeTruthy();

    fetchMock.mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    await userEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(await screen.findByText("No users")).toBeTruthy();
  });

  it("offers to clear filters when an empty result has filters applied", async () => {
    const onClear = vi.fn();
    render(
      <DataTable
        caption="users"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        status="ready"
        filtersActive
        onClearFilters={onClear}
        emptyTitle="No users"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("admin.filters.clear") }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("opens a row from the click and from its keyboard-reachable name button", async () => {
    const onOpen = vi.fn();
    render(
      <DataTable
        caption="users"
        columns={columns}
        rows={[user(1)]}
        rowKey={(row) => row.id}
        status="ready"
        onOpenRow={onOpen}
        emptyTitle="none"
      />,
    );
    const table = screen.getByRole("table");
    await userEvent.click(within(table).getByRole("button", { name: "User 1" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(within(table).getByText("user1@example.com"));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe("FilterBar and the URL", () => {
  it("writes a debounced search to the URL, replacing history without scrolling", async () => {
    render(<FilterBar fields={[{ kind: "search", name: "q", label: "Search" }]} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "sara");
    // Typing alone has not touched the URL yet.
    expect(replace).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(replace).toHaveBeenCalledWith("/admin/users?q=sara", { scroll: false });
      },
      { timeout: SEARCH_DEBOUNCE_MS * 5 },
    );
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("writes a select immediately and keeps other params", async () => {
    search = "q=sara";
    render(
      <FilterBar
        fields={[
          { kind: "search", name: "q", label: "Search" },
          {
            kind: "select",
            name: "status",
            label: "Status",
            allLabel: "All",
            options: [
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
            ],
          },
        ]}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Status"), "suspended");
    expect(replace).toHaveBeenCalledWith("/admin/users?q=sara&status=suspended", {
      scroll: false,
    });
  });

  it("reads its initial values from the URL and clears them all", async () => {
    search = "q=sara&status=active";
    render(
      <FilterBar
        fields={[
          { kind: "search", name: "q", label: "Search" },
          {
            kind: "select",
            name: "status",
            label: "Status",
            allLabel: "All",
            options: [{ value: "active", label: "Active" }],
          },
        ]}
      />,
    );
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe(
      "sara",
    );
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("active");
    await userEvent.click(screen.getByRole("button", { name: t("admin.filters.clear") }));
    expect(replace).toHaveBeenLastCalledWith("/admin/users", { scroll: false });
  });
});
