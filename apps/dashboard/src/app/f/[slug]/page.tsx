import { getPublicFormState } from "@mirror/core";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { LoginBackdrop } from "@/components/login-backdrop";
import { PublicForm, type PublicFormField } from "@/components/public-form";
import { SiteFooter } from "@/components/site-footer";
import { publicLockedOut } from "@/lib/session";

type PageProps = { params: Promise<{ slug: string }> };

// Always reflects the current state of the form (disabled, expired, full, edited).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await getPublicFormState((await params).slug);
  return {
    title: found?.form ? found.form.name : found ? "Форма отключена" : "Форма не найдена",
    robots: { index: false, follow: false },
  };
}

function numberOrNull(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Why the form takes no answers: one icon, one line. */
function Closed({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="form-state" data-tone="muted" role="status">
      <span className="form-state-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
          <rect x="5.5" y="10.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export default async function PublicFormPage({ params }: PageProps) {
  if (await publicLockedOut()) redirect("/maintenance");
  const { slug } = await params;
  const found = await getPublicFormState(slug);
  if (!found) notFound();
  const { state, form } = found;

  const fields: PublicFormField[] = (form?.fields ?? []).map((field) => {
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
    <div className="public-page public-page-login form-page">
      <LoginBackdrop />
      <main className="form-stage">
        <div className="form-card">
          <div className="form-card-head">
            <BrandMark />
            <span className="hud-label">Mirror · GTA5RP</span>
            <h1>{form ? form.name : "Форма"}</h1>
            {form?.description && state === "open" ? (
              <p className="muted public-form-description">{form.description}</p>
            ) : null}
          </div>
          {state === "open" && form ? (
            <PublicForm slug={form.slug ?? slug} fields={fields} successMessage={form.successMessage} />
          ) : state === "expired" ? (
            <Closed title="Приём ответов завершён">Срок действия этой формы истёк.</Closed>
          ) : state === "full" ? (
            <Closed title="Лимит ответов исчерпан">Форма уже собрала нужное число ответов.</Closed>
          ) : (
            <Closed title="Форма отключена">Сейчас ответы не принимаются.</Closed>
          )}
        </div>
      </main>
      <SiteFooter compact />
    </div>
  );
}
