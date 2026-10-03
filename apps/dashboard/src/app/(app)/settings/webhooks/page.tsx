import { listWebhookRequests } from "@mirror/core";
import { RecordStatus, prisma, type Prisma } from "@mirror/db";
import Link from "next/link";
import { PageTabs, currentTab } from "@/components/page-tabs";
import { Pager, RegistryToolbar, registryQuery } from "@/components/registry-toolbar";
import { WebhooksQueue } from "@/components/webhooks-queue";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";
import { EmptyState } from "@/components/ui";

export const metadata = { title: "Вебхуки" };

const PATH = "/settings/webhooks";
const PAGE_SIZE = 50;
const TABS = [
  { key: "requests", label: "Запросы", icon: "hook" },
  { key: "archive", label: "Архив", icon: "list" },
] as const;

/** Stored status of a form → how it is called on the site. */
const FORM_STATUS: Record<string, { label: string; tone: string; status: RecordStatus }> = {
  ACTIVE: { label: "Активна", tone: "ok", status: RecordStatus.ACTIVE },
  CLOSED: { label: "Отключена", tone: "warn", status: RecordStatus.CLOSED },
  ARCHIVED: { label: "В архиве", tone: "muted", status: RecordStatus.ARCHIVED },
};

type Search = { tab?: string; q?: string; status?: string; page?: string };

export default async function WebhooksPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSystemSettingsPage();
  const params = await searchParams;
  const tab = currentTab(TABS, params.tab);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Вебхуки</h1>
      </div>
      <PageTabs path={PATH} tabs={TABS} current={tab} />
      {tab === "requests" ? <RequestsTab /> : <ArchiveTab params={params} />}
    </div>
  );
}

async function RequestsTab() {
  const requests = await listWebhookRequests({ limit: 50 });
  return <WebhooksQueue initial={requests.map((request) => ({ ...request, createdAt: request.createdAt.toISOString() }))} />;
}

/** Every form that was ever created, whatever its state now. */
async function ArchiveTab({ params }: { params: Search }) {
  const query = registryQuery(params);
  const status = query.status ? FORM_STATUS[query.status]?.status : undefined;
  const where: Prisma.DiscordFormWhereInput = {
    ...(status ? { status } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { description: { contains: query.q, mode: "insensitive" } },
            { slug: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, forms] = await Promise.all([
    prisma.discordForm.count({ where }),
    prisma.discordForm.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { fields: true, submissions: true } } },
    }),
  ]);
  const labels = await resolveAuthorLabels(forms.map((form) => form.createdByDiscordId));

  return (
    <>
      <RegistryToolbar
        path={PATH}
        resetHref={`${PATH}?tab=archive`}
        query={query}
        statuses={Object.fromEntries(Object.entries(FORM_STATUS).map(([key, value]) => [key, value.label]))}
        placeholder="Название, описание, адрес формы"
      >
        <input type="hidden" name="tab" value="archive" />
      </RegistryToolbar>
      <div className="panel">
        {forms.length === 0 ? (
          <EmptyState title="Форм не найдено" />
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Форма</th>
                  <th>Статус</th>
                  <th>Полей</th>
                  <th>Ответов</th>
                  <th>Доставка</th>
                  <th>Создал</th>
                  <th>Создана</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {forms.map((form) => {
                  const state = FORM_STATUS[form.status] ?? { label: form.status, tone: "muted" };
                  return (
                    <tr key={form.id}>
                      <td>
                        {form.name}
                        {form.slug && form.publicEnabled ? <span className="muted registry-note">/f/{form.slug}</span> : null}
                      </td>
                      <td>
                        <span className="registry-status" data-status={state.tone}>
                          {state.label}
                        </span>
                      </td>
                      <td>{form._count.fields}</td>
                      <td>{form._count.submissions}</td>
                      <td>{form.webhookUrl ? "вебхук" : form.deliveryChannelId ? "канал" : "—"}</td>
                      <td>{labels.get(form.createdByDiscordId) ?? form.createdByDiscordId}</td>
                      <td className="nowrap">{formatMoscowShort(form.createdAt)}</td>
                      <td className="cell-actions">
                        <div className="registry-actions">
                          <Link href={`/settings/forms/${form.id}/responses`} className="btn btn-ghost">
                            Ответы
                          </Link>
                          {form.status !== RecordStatus.ARCHIVED ? (
                            <Link href={`/settings/forms/${form.id}`} className="btn btn-ghost">
                              Изменить
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          path={PATH}
          params={{ tab: "archive", q: query.q, status: query.status }}
          page={query.page}
          pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          total={total}
        />
      </div>
    </>
  );
}
