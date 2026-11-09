import { projectActivity, type ActivityType, type Db } from "@sceneflow/server";

/** One line of the agency feed ("Mia approved Spring launch"). Never throws: a feed entry must not fail the action. */
export async function logActivity(db: Db, entry: { workspaceId: string; projectId: string; type: ActivityType; actorName: string; detail?: string | null }): Promise<void> {
  try {
    await db.insert(projectActivity).values({ ...entry, detail: entry.detail ?? null });
  } catch {
    /* the feed is informational */
  }
}
