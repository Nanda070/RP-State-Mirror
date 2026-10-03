"use client";

import dynamic from "next/dynamic";

function EmbedManagerFallback() {
  return (
    <div className="panel" aria-busy="true">
      <span className="skeleton sk sk-label" />
      <span className="skeleton sk sk-block" />
    </div>
  );
}

export const EmbedManagerLazy = dynamic(
  () => import("./embed-manager").then((m) => m.EmbedManager),
  { ssr: false, loading: () => <EmbedManagerFallback /> },
);
