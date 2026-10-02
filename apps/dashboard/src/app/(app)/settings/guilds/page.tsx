import { redirect } from "next/navigation";

/** Back-compat: system guild settings live at /settings/system. */
export default function SettingsGuildsRedirect() {
  redirect("/settings/system");
}
