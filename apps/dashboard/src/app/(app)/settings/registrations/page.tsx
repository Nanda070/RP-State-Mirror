import { redirect } from "next/navigation";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsRegistrationsPage() {
  await requireSystemSettingsPage();
  redirect("/settings/stage4?tab=registrations");
}
