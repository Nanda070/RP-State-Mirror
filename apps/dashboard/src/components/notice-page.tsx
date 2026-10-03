import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { LoginBackdrop } from "./login-backdrop";
import { SiteFooter } from "./site-footer";

/**
 * Full-page notice outside the app shell: no access, not found, maintenance, error.
 * Built from the login page's own blocks (backdrop, hero card), so it always looks like it.
 */
export function NoticePage({
  code,
  title,
  children,
  actions,
}: {
  /** Short marker above the title: «404», «Техработы». */
  code?: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="public-page public-page-login notice-page">
      <LoginBackdrop />
      <div className="hero">
        <div className="hero-card notice-card">
          <BrandMark />
          <p className="hero-brand">Mirror · GTA5RP</p>
          {code ? <p className="notice-code">{code}</p> : null}
          <h1 className="hero-title">{title}</h1>
          <div className="notice-text">{children}</div>
          <div className="notice-actions">
            {actions ?? (
              <Link href="/" className="btn btn-primary">
                На главную
              </Link>
            )}
          </div>
        </div>
      </div>
      <SiteFooter compact />
    </div>
  );
}
