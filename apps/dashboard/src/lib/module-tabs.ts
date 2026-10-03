/** Tabs of «Настройки → Модули». Plain data: read on the server (the page) and in the browser (the strip). */
export const MODULE_TABS = [
  { id: "documents", label: "Документы", icon: "doc" },
  { id: "wanted", label: "Розыск", icon: "target" },
  { id: "registrations", label: "Регистрации", icon: "car" },
  { id: "transfers", label: "Переводы", icon: "swap" },
  { id: "icBlacklist", label: "IC ЧС", icon: "ban" },
  { id: "tokens", label: "Нашивки", icon: "tag" },
  { id: "vehicleRequests", label: "Запрос ТС", icon: "key" },
  { id: "webhooks", label: "Вебхуки", icon: "hook" },
  { id: "feedback", label: "Обратная связь", icon: "chat" },
  { id: "invites", label: "Приглашения", icon: "link" },
] as const;

export type ModuleTab = (typeof MODULE_TABS)[number]["id"];

export function moduleTab(requested: string | undefined): ModuleTab {
  return MODULE_TABS.find((tab) => tab.id === requested)?.id ?? "documents";
}
