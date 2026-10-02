"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { BrandMark } from "./brand-mark";
import { LoginButton } from "./login-button";
import { SiteFooter } from "./site-footer";

export function LoginHero({ nextPath }: { nextPath?: string }) {
  return (
    <div className="public-page">
      <header className="public-nav">
        <div className="public-nav-brand">
          <BrandMark />
          <div>
            <div className="brand">Mirror · GTA5RP</div>
            <span className="sub">Dashboard</span>
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => signIn("discord")}>
          Войти
        </button>
      </header>

      <div className="hero">
        <motion.div
          className="hero-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <BrandMark />
          <h1 className="brand">Mirror · GTA5RP</h1>
          <p className="lead">
            Единый дашборд государственных фракций. Вход только через Discord, права — по ролям на
            главном сервере.
          </p>
          <LoginButton />
          {nextPath ? (
            <p className="muted" style={{ marginTop: "0.85rem", marginBottom: 0, fontSize: "0.88rem" }}>
              После входа откроем: {nextPath}
            </p>
          ) : null}
          <p className="legal-inline">
            <Link href="/terms">Условия</Link>
            {" · "}
            <Link href="/privacy">Конфиденциальность</Link>
          </p>
        </motion.div>
      </div>

      <SiteFooter />
    </div>
  );
}
