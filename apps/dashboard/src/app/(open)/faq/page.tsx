import { canViewModules, listFaq } from "@mirror/core";
import { FaqBrowser } from "@/components/faq-browser";
import { openSectionIdentity } from "@/lib/session";

export const metadata = { title: "FAQ" };

export default async function FaqPage() {
  const [identity, sections] = await Promise.all([openSectionIdentity(), listFaq()]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>FAQ и документация</h1>
        <p className="muted">Ответы на частые вопросы и инструкции по командам бота и разделам сайта.</p>
      </div>
      <FaqBrowser
        canEdit={identity ? canViewModules(identity) : false}
        sections={sections.map((section) => ({
          id: section.id,
          title: section.title,
          items: section.items.map((item) => ({ id: item.id, title: item.title, body: item.body })),
        }))}
      />
    </div>
  );
}
