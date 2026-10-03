"use client";

import dynamic from "next/dynamic";

function EmbedManagerFallback() {
  return (
    <div className="panel" aria-busy="true">
      <div className="skeleton" style={{ height: "1.1rem", width: "10rem", marginBottom: "1rem" }} />
      <div className="skeleton" style={{ height: "14rem", width: "100%" }} />
    </div>
  );
}

export const EmbedManagerLazy = dynamic(
  () => import("./embed-manager").then((m) => m.EmbedManager),
  { ssr: false, loading: () => <EmbedManagerFallback /> },
);
