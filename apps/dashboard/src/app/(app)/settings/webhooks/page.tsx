import { listWebhookRequests } from "@mirror/core";
import Link from "next/link";
import { WebhooksQueue } from "@/components/webhooks-queue";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsWebhooksPage() {
  await requireSystemSettingsPage();
  const requests = await listWebhookRequests({ limit: 50 });

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Webhooks</h1>
        <p className="muted">
          Очередь запросов <code>/создать-webhook</code> и переход к сборке Discord-форм.
        </p>
        <div className="status-link-row">
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/settings/forms" className="stub-link">
            К формам
          </Link>
        </div>
      </div>
      <WebhooksQueue
        initial={requests.map((req) => ({
          ...req,
          createdAt: req.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
