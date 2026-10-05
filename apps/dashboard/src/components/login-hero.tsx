"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { LoginBackdrop } from "./login-backdrop";
import { LoginButton } from "./login-button";
import { SiteFooter } from "./site-footer";

export function LoginHero({ nextPath }: { nextPath?: string }) {
  return (
    <div className="public-page public-page-login">
      <LoginBackdrop />
      <div className="hero">
        <motion.div
          className="hero-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <BrandMark />
          <p className="hero-brand">Mirror · GTA5RP</p>
          <h1 className="hero-title">Панель управления</h1>
          <p className="lead">Войдите, чтобы продолжить.</p>
          <LoginButton label="Продолжить через Discord" />
          {nextPath ? (
            <p className="muted hero-next">После входа откроем: {nextPath}</p>
          ) : null}
          <p className="legal-inline">
            Продолжая, вы принимаете{" "}
            <Link href="/terms">условия</Link>
            {" и "}
            <Link href="/privacy">политику конфиденциальности</Link>.
          </p>
          <nav className="hero-open" aria-label="Разделы без входа">
            <Link href="/catalog">Каталог ТС</Link>
            <Link href="/calculator">Калькулятор</Link>
            <Link href="/faq">FAQ</Link>
          </nav>
        </motion.div>
      </div>

      <SiteFooter compact />
    </div>
  );
}
