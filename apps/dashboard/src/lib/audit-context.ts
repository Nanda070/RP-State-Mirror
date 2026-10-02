import { type AuditContext } from "@mirror/core";
import { AuditActorType } from "@mirror/db";
import { headers } from "next/headers";

export async function dashboardAuditContext(actorUserId: string): Promise<AuditContext> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  return {
    actorType: AuditActorType.USER,
    actorUserId,
    source: "dashboard",
    ...(ip ? { ipAddress: ip } : {}),
  };
}
