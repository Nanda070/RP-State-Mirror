import { redirect } from "next/navigation";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsTokensPage() {
  await requireSystemSettingsPage();
  redirect("/settings/stage4?tab=tokens");
}
