import { getPublicForm } from "@mirror/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { PublicForm, type PublicFormField } from "@/components/public-form";
import { SiteFooter } from "@/components/site-footer";
import { turnstileSiteKey } from "@/lib/public-request";

type PageProps = { params: Promise<{ slug: string }> };

// Always reflects the current state of the form (disabled, expired, edited).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const form = await getPublicForm((await params).slug);
  return {
    title: form ? `${form.name} · Mirror` : "Форма не найдена · Mirror",
    robots: { index: false, follow: false },
  };
}

function numberOrNull(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default async function PublicFormPage({ params }: PageProps) {
  const { slug } = await params;
  const form = await getPublicForm(slug);
  if (!form) notFound();

  const expired = form.expiresAt !== null && form.expiresAt <= new Date();
  const fields: PublicFormField[] = form.fields.map((field) => {
    const validation =
      field.validation && typeof field.validation === "object" && !Array.isArray(field.validation)
        ? (field.validation as Record<string, unknown>)
        : {};
    return {
      key: field.key,
      label: field.label,
      type: field.type as PublicFormField["type"],
      required: field.required,
      helpText: field.helpText,
      options: Array.isArray(field.options)
        ? field.options.filter((option): option is string => typeof option === "string")
        : [],
      minLength: numberOrNull(validation, "minLength"),
      maxLength: numberOrNull(validation, "maxLength"),
      min: numberOrNull(validation, "min"),
      max: numberOrNull(validation, "max"),
    };
  });

  return (
    <div className="legal-page">
      <header className="public-nav">
        <Link href="/" className="public-nav-brand">
          <BrandMark />
          <div>
            <div className="brand">Mirror · GTA5RP</div>
            <span className="sub">Форма</span>
          </div>
        </Link>
      </header>
      <main className="legal">
        <h1>{form.name}</h1>
        {form.description ? <p className="muted public-form-description">{form.description}</p> : null}
        {expired ? (
          <div className="panel empty-state">
            <h2 className="panel-title">Приём ответов завершён</h2>
            <p className="muted">Срок действия этой формы истёк.</p>
          </div>
        ) : (
          <PublicForm
            slug={form.slug ?? slug}
            fields={fields}
            captchaSiteKey={form.captchaRequired ? turnstileSiteKey() : null}
            successMessage={form.successMessage}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
