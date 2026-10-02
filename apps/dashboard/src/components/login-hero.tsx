"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { LoginButton } from "./login-button";
import { SiteFooter } from "./site-footer";
import { ThemeSelect } from "./theme-provider";

export function LoginHero({ nextPath }: { nextPath?: string }) {
  return (
    <div className="hero">
      <div className="hero-orb" style={{ left: "-10vw", top: "-8vw" }} />
      <div className="hero-orb secondary" />
      <motion.div
        className="hero-card"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <span className="muted">Вход</span>
          <ThemeSelect />
        </div>
        <h1 className="brand">Mirror · GTA5RP</h1>
        <p className="lead">
          Единый дашборд государственных фракций. Вход только через Discord, права — по ролям на
          главном сервере.
        </p>
        <LoginButton />
        {nextPath ? <p className="muted">После входа откроем: {nextPath}</p> : null}
        <p className="muted" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
          <Link href="/terms">Условия</Link>
          {" · "}
          <Link href="/privacy">Конфиденциальность</Link>
          {" · "}
          <Link href="/cookies">Cookie</Link>
        </p>
      </motion.div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
        <SiteFooter />
      </div>
    </div>
  );
}
