"use client";

import { useEffect } from "react";
import { APPEARANCE_COOKIE, applyAppearance, decodeAppearance, encodeAppearance, type AppearanceValue } from "@/lib/appearance";

/**
 * The look saved in the profile follows the person to every device: when this browser remembers
 * something else (or nothing), the saved look is applied and remembered here too.
 */
export function AppearanceSync({ value }: { value: AppearanceValue }) {
  useEffect(() => {
    const match = document.cookie.match(new RegExp(`(?:^|; )${APPEARANCE_COOKIE}=([^;]*)`));
    const remembered = decodeAppearance(match?.[1]);
    if (!remembered || encodeAppearance(remembered) !== encodeAppearance(value)) applyAppearance(value);
  }, [value]);
  return null;
}
