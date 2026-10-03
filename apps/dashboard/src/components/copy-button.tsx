"use client";

import { useState } from "react";

/** Copies a value; the label confirms it for a moment. A blocked clipboard shows the value to copy by hand. */
export function CopyButton({
  value,
  label = "Копировать",
  className = "btn btn-ghost",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
      setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("manual");
    }
  }

  if (state === "manual") {
    return <input className="copy-manual" readOnly value={value} aria-label={label} onFocus={(event) => event.target.select()} autoFocus />;
  }
  return (
    <button type="button" className={className} onClick={() => void copy()}>
      {state === "done" ? "Скопировано" : label}
    </button>
  );
}

/** A long address is not printed: it is opened or copied. */
export function LinkActions({ href, external = true }: { href: string; external?: boolean }) {
  return (
    <span className="link-actions">
      <a className="btn btn-ghost" href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        Открыть
      </a>
      <CopyButton value={href} />
    </span>
  );
}
