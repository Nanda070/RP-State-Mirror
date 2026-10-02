import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="footer">
      <nav aria-label="Юридические ссылки">
        <Link href="/terms">Условия использования</Link>
        <Link href="/privacy">Конфиденциальность</Link>
        <Link href="/cookies">Cookie</Link>
      </nav>
      <div>Mirror · GTA5RP · время МСК (Europe/Moscow)</div>
    </footer>
  );
}
