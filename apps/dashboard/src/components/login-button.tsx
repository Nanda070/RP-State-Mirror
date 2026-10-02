"use client";

import { signIn } from "next-auth/react";

export function LoginButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => signIn("discord")}>
      Продолжить через Discord
    </button>
  );
}
