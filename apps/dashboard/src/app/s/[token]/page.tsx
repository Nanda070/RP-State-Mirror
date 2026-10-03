import { resolveShareLink } from "@mirror/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { SiteFooter } from "@/components/site-footer";
import { formatMoscow } from "@/lib/moscow";
import { publicLockedOut } from "@/lib/session";

type PageProps = { params: Promise<{ token: string }> };

// A revoked link must stop working immediately.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Запись реестра",
  // The address is a secret: keep it out of search engines and out of the Referer header.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedRecordPage({ params }: PageProps) {
  if (await publicLockedOut()) redirect("/maintenance");
  const { token } = await params;
  const card = await resolveShareLink(token);
  if (!card) notFound();

  return (
    <div className="legal-page">
      <header className="public-nav">
        <Link href="/" className="public-nav-brand">
          <BrandMark />
          <div>
            <div className="brand">Mirror · GTA5RP</div>
            <span className="sub">Реестр</span>
          </div>
        </Link>
      </header>
      <main className="legal">
        <p className="muted share-kind">{card.kind}</p>
        <div className="row share-title">
          <h1>{card.title}</h1>
          <span className="registry-status" data-status={card.status.tone}>
            {card.status.label}
          </span>
        </div>
        <div className="panel">
          <dl className="profile-facts">
            {card.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd className="share-value">{fact.value}</dd>
              </div>
            ))}
            <div>
              <dt>Дата записи (МСК)</dt>
              <dd>{formatMoscow(card.createdAt)}</dd>
            </div>
          </dl>
          {card.photoFileId ? (
            <img className="share-photo" src={`/s/${encodeURIComponent(token)}/photo`} alt={card.title} />
          ) : null}
        </div>
        <p className="muted share-note-public">
          Краткая карточка записи реестра Mirror · GTA5RP. Данные относятся к игровому персонажу. Ссылку выдал
          администратор; она может быть отозвана.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
