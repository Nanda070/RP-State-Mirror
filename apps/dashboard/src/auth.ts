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

export type SessionIdentity = Pick<
  Identity,
  "discordUserId" | "isSuperAdmin" | "adminLevel" | "factions" | "permissions"
>;

type MirrorJWT = JWT & {
  discordId?: string;
  username?: string | null;
  userId?: string;
  identity?: SessionIdentity;
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

function discordAvatarUrl(id: string, avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}`;
}

const env = getDashboardEnv();

export const { handlers, auth, signIn, signOut } = NextAuth({
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
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
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
    async jwt({ token, profile, trigger }) {
      const mirrorToken = token as MirrorJWT;
      const discordId =
        (typeof profile?.id === "string" ? profile.id : undefined) ?? mirrorToken.discordId;
      if (!discordId) return mirrorToken;

      if (profile || trigger === "update" || !mirrorToken.identity) {
        const { user } = await ensureUserByDiscordId(discordId);
        mirrorToken.discordId = discordId;
        mirrorToken.userId = user.id;

        if (profile) {
          const p = profile as {
            username?: string;
            global_name?: string | null;
            name?: string | null;
            image?: string | null;
            avatar?: string | null;
          };
          mirrorToken.username = p.username ?? mirrorToken.username ?? null;
          const displayName = p.global_name ?? p.name ?? p.username ?? mirrorToken.name ?? null;
          if (displayName !== undefined) mirrorToken.name = displayName;
          const picture = p.image ?? discordAvatarUrl(discordId, p.avatar) ?? mirrorToken.picture;
          if (picture !== undefined) mirrorToken.picture = picture;
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
      };
      session.identity = mirrorToken.identity;
      return session;
    },
  },
});

export function publicOrigin(): string {
  return authBaseUrl(getDashboardEnv());
}
