import { Inject, Injectable } from "@nestjs/common";
import { files, type FileRecord, type NewFileRecord } from "@wasfa/db";
import { and, eq, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

/** Who is asking: a file is visible to its owning user, or to a member of its owning organization. */
export interface FileViewer {
  id: string;
  orgIds: readonly string[];
}

/** Every query of the uploads module. Owner-scoped: someone else's file looks like no file. */
@Injectable()
export class FilesRepo {
  private readonly ofUser: ScopedRepo<typeof files>;
  private readonly ofOrg: ScopedRepo<typeof files>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.ofUser = scopedRepo(handle.db, { table: files, scope: files.ownerUserId, id: files.id });
    this.ofOrg = scopedRepo(handle.db, { table: files, scope: files.ownerOrgId, id: files.id });
  }

  async insert(values: NewFileRecord): Promise<FileRecord> {
    const [row] = await this.handle.db.insert(files).values(values).returning();
    if (!row) throw new Error("Insert into files returned no row");
    return row;
  }

  /** The viewer's own file, or one owned by an organization they belong to; `null` otherwise. */
  async findFor(viewer: FileViewer, fileId: string): Promise<FileRecord | null> {
    const own = await this.ofUser.find(viewer.id, fileId);
    if (own) return own;
    for (const orgId of viewer.orgIds) {
      const shared = await this.ofOrg.find(orgId, fileId);
      if (shared) return shared;
    }
    return null;
  }

  /** `pending` to `uploaded`. False when another request got there first (or the state moved on). */
  async markUploaded(file: FileRecord): Promise<boolean> {
    const rows = await this.handle.db
      .update(files)
      .set({ status: "uploaded", updatedAt: new Date() })
      .where(and(this.ownedBy(file), eq(files.status, "pending")))
      .returning({ id: files.id });
    return rows.length > 0;
  }

  /** Marks a pending upload `rejected` with a reason code the web app can explain. */
  async markRejected(file: FileRecord, reason: string): Promise<void> {
    await this.handle.db
      .update(files)
      .set({ status: "rejected", rejectReason: reason, updatedAt: new Date() })
      .where(and(this.ownedBy(file), eq(files.status, "pending")));
  }

  private ownedBy(file: FileRecord): SQL | undefined {
    if (file.ownerUserId !== null) {
      return and(eq(files.id, file.id), eq(files.ownerUserId, file.ownerUserId));
    }
    if (file.ownerOrgId !== null) {
      return and(eq(files.id, file.id), eq(files.ownerOrgId, file.ownerOrgId));
    }
    throw new Error("A file always has an owner (files_owner_check)");
  }
}
