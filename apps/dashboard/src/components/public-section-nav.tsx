"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/catalog", label: "Каталог ТС" },
  { href: "/calculator", label: "Калькулятор" },
  { href: "/faq", label: "FAQ" },
  { href: "/tables", label: "Таблицы" },
];

/** What a guest sees in the header of the open sections: the sections and a way to sign in. */
export function PublicSectionNav() {
  const pathname = usePathname();
  const current = SECTIONS.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));
  return (
    <>
      <nav className="public-nav-links" aria-label="Открытые разделы">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            data-active={section === current ? "" : undefined}
            aria-current={section === current ? "page" : undefined}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      <Link href={`/?next=${current?.href ?? "/overview"}`} className="btn btn-ghost">
        Войти
      </Link>
    </>
  );
}
