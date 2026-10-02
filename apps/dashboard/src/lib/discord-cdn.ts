/** Discord CDN helpers for avatar / banner URLs from OAuth profile hashes. */

export function discordAvatarUrl(id: string, avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=256`;
}

export function discordBannerUrl(id: string, banner: string | null | undefined): string | null {
  if (!banner) return null;
  const ext = banner.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/banners/${id}/${banner}.${ext}?size=1024`;
}

/** Discord accent_color is a decimal RGB integer; null when unset. */
export function discordAccentCss(accentColor: number | null | undefined): string | null {
  if (accentColor == null || accentColor < 0) return null;
  const hex = accentColor.toString(16).padStart(6, "0");
  return `#${hex}`;
}
