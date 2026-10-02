import {
  canBootstrapDashboard,
  ensureUserByDiscordId,
  getSetting,
  resolveIdentity,
  type Identity,
} from "@mirror/core";
import { AuditActorType } from "@mirror/db";
import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import type { JWT } from "next-auth/jwt";
import { authBaseUrl, getDashboardEnv } from "./env";
import { discordAccentCss, discordAvatarUrl, discordBannerUrl } from "./lib/discord-cdn";

export type SessionIdentity = Pick<
  Identity,
  "discordUserId" | "isSuperAdmin" | "adminLevel" | "factions" | "permissions"
>;

type MirrorJWT = JWT & {
  discordId?: string;
  username?: string | null;
  userId?: string;
  bannerUrl?: string | null;
  accentColor?: string | null;
  identity?: SessionIdentity;
};

type DiscordMe = {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  banner?: string | null;
  accent_color?: number | null;
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      discordId: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      username?: string | null;
      bannerUrl?: string | null;
      accentColor?: string | null;
    };
    identity: SessionIdentity;
  }
}

async function loadIdentity(discordId: string): Promise<SessionIdentity> {
  const env = getDashboardEnv();
  const identity = await resolveIdentity(discordId, { superAdminUserIds: env.SUPER_ADMIN_USER_IDS });
  return {
    discordUserId: identity.discordUserId,
    isSuperAdmin: identity.isSuperAdmin,
    adminLevel: identity.adminLevel,
    factions: identity.factions,
    permissions: identity.permissions,
  };
}

/** Fetch raw Discord user (includes banner hash) — Auth.js profile omits it. */
async function fetchDiscordMe(accessToken: string): Promise<DiscordMe | null> {
  try {
    const response = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as DiscordMe;
  } catch {
    return null;
  }
}

/**
 * Config factory: Discord env is read when Auth.js needs config, not at module import.
 * Keeps `next build` / typecheck import-safe; CI still supplies dummy env for safety.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const env = getDashboardEnv();
  return {
    trustHost: true,
    secret: env.SESSION_SECRET,
    providers: [
      Discord({
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        authorization: {
          params: { scope: "identify guilds.members.read" },
        },
      }),
    ],
    session: { strategy: "jwt" as const, maxAge: 60 * 60 * 24 * 14 },
    pages: {
      signIn: "/",
      error: "/denied",
    },
    callbacks: {
      async signIn({ profile }) {
        const discordId = typeof profile?.id === "string" ? profile.id : undefined;
        if (!discordId) return false;

        await ensureUserByDiscordId(discordId, {
          actorType: AuditActorType.SYSTEM,
          source: "dashboard.oauth",
          metadata: { event: "sign_in" },
        });

        const identity = await loadIdentity(discordId);
        const mainGuildId = await getSetting("core.mainGuildId");
        if (!canBootstrapDashboard(identity, mainGuildId)) {
          return "/denied?reason=bootstrap";
        }
        return true;
      },
      async jwt({ token, profile, account, trigger }) {
        const mirrorToken = token as MirrorJWT;
        const discordId =
          (typeof profile?.id === "string" ? profile.id : undefined) ?? mirrorToken.discordId;
        if (!discordId) return mirrorToken;

        if (profile || account || trigger === "update" || !mirrorToken.identity) {
          const { user } = await ensureUserByDiscordId(discordId);
          mirrorToken.discordId = discordId;
          mirrorToken.userId = user.id;

          const me = account?.access_token ? await fetchDiscordMe(account.access_token) : null;

          if (me) {
            mirrorToken.username = me.username ?? mirrorToken.username ?? null;
            mirrorToken.name = me.global_name ?? me.username ?? mirrorToken.name ?? null;
            const picture = discordAvatarUrl(discordId, me.avatar);
            if (picture) mirrorToken.picture = picture;
            mirrorToken.bannerUrl = discordBannerUrl(discordId, me.banner);
            mirrorToken.accentColor = discordAccentCss(me.accent_color);
          } else if (profile) {
            const p = profile as {
              username?: string;
              global_name?: string | null;
              name?: string | null;
              image?: string | null;
              avatar?: string | null;
              banner?: string | null;
              accent_color?: number | null;
            };
            mirrorToken.username = p.username ?? mirrorToken.username ?? null;
            const displayName = p.global_name ?? p.name ?? p.username ?? mirrorToken.name ?? null;
            if (displayName !== undefined) mirrorToken.name = displayName;
            const picture = p.image ?? discordAvatarUrl(discordId, p.avatar) ?? mirrorToken.picture;
            if (picture !== undefined) mirrorToken.picture = picture;
            if (p.banner !== undefined) {
              mirrorToken.bannerUrl = discordBannerUrl(discordId, p.banner);
            }
            if (p.accent_color !== undefined) {
              mirrorToken.accentColor = discordAccentCss(p.accent_color);
            }
          }

          mirrorToken.identity = await loadIdentity(discordId);
        }
        return mirrorToken;
      },
      async session({ session, token }) {
        const mirrorToken = token as MirrorJWT;
        if (!mirrorToken.discordId || !mirrorToken.userId || !mirrorToken.identity) {
          return session;
        }
        session.user = {
          ...session.user,
          id: mirrorToken.userId,
          discordId: mirrorToken.discordId,
          username: mirrorToken.username ?? null,
          name: mirrorToken.name ?? session.user?.name ?? null,
          image:
            (typeof mirrorToken.picture === "string" ? mirrorToken.picture : null) ??
            session.user?.image ??
            null,
          bannerUrl: mirrorToken.bannerUrl ?? null,
          accentColor: mirrorToken.accentColor ?? null,
        };
        session.identity = mirrorToken.identity;
        return session;
      },
    },
  };
});

export function publicOrigin(): string {
  return authBaseUrl(getDashboardEnv());
}
