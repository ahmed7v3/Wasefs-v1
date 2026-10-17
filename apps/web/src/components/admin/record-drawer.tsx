"use client";

import { useCallback, useMemo } from "react";

import { useUrlParams } from "../../lib/use-url-params";

import { DetailDrawer } from "./drawer";

import type { ReactNode } from "react";

/** The id of the record open in the URL (`?open=<id>`), and how to open or close one. */
export function useOpenRecord(param = "open") {
  const { get, update } = useUrlParams();
  const raw = get(param);
  const open = useCallback(
    (next: string) => {
      update({ [param]: next });
    },
    [update, param],
  );
  const close = useCallback(() => {
    update({ [param]: null });
  }, [update, param]);
  return useMemo(() => ({ id: raw === "" ? null : raw, open, close }), [raw, open, close]);
}

export interface RecordDrawerProps {
  /** Query param holding the record id; `open` for every billing list. */
  param?: string;
  title: ReactNode;
  children: (id: string, close: () => void) => ReactNode;
}

/**
 * A drawer whose open state lives in the URL, so a record has a shareable link and Back closes it
 * (ADMIN-CONSOLE-SPEC §1.3). The body is rendered only while a record is open.
 */
export function RecordDrawer({ param = "open", title, children }: RecordDrawerProps) {
  const record = useOpenRecord(param);
  return (
    <DetailDrawer open={record.id !== null} onClose={record.close} title={title}>
      {record.id !== null ? children(record.id, record.close) : null}
    </DetailDrawer>
  );
}
