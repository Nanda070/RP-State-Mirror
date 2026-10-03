import { describe, expect, it } from "vitest";
import { planCpSync, type CpFactionLink } from "../src/cp-sync.js";

const links: CpFactionLink[] = [
  {
    factionCode: "LSPD",
    factionGuildDiscordId: "guild-lspd",
    sourceRoleIds: ["src-lspd"],
    targetRoleIds: ["cp-lspd"],
  },
  {
    factionCode: "EMS",
    factionGuildDiscordId: "guild-ems",
    sourceRoleIds: ["src-ems"],
    targetRoleIds: ["cp-ems"],
  },
];

const managed = ["cp-lspd", "cp-ems"];

describe("planCpSync", () => {
  it("skips bots, owners and excluded roles", () => {
    expect(
      planCpSync({
        userDiscordId: "u",
        isBot: true,
        isOwner: false,
        excludedRoleIds: [],
        incidentRoleIds: [],
        memberships: new Map(),
        links,
        managedTargetRoleIds: managed,
      }).kind,
    ).toBe("skip");

    expect(
      planCpSync({
        userDiscordId: "u",
        isBot: false,
        isOwner: true,
        excludedRoleIds: [],
        incidentRoleIds: [],
        memberships: new Map(),
        links,
        managedTargetRoleIds: managed,
      }).kind,
    ).toBe("skip");

    expect(
      planCpSync({
        userDiscordId: "u",
        isBot: false,
        isOwner: false,
        excludedRoleIds: ["vip"],
        incidentRoleIds: ["vip"],
        memberships: new Map(),
        links,
        managedTargetRoleIds: managed,
      }).kind,
    ).toBe("skip");
  });

  it("kicks when no faction source roles", () => {
    const plan = planCpSync({
      userDiscordId: "u",
      isBot: false,
      isOwner: false,
      excludedRoleIds: [],
      incidentRoleIds: ["cp-lspd"],
      memberships: new Map([["guild-lspd", []]]),
      links,
      managedTargetRoleIds: managed,
    });
    expect(plan).toEqual({ kind: "kick", reason: "no_faction_roles" });
  });

  it("adds and removes managed roles to match membership", () => {
    const plan = planCpSync({
      userDiscordId: "u",
      isBot: false,
      isOwner: false,
      excludedRoleIds: [],
      incidentRoleIds: ["cp-ems", "other"],
      memberships: new Map([
        ["guild-lspd", ["src-lspd"]],
        ["guild-ems", []],
      ]),
      links,
      managedTargetRoleIds: managed,
    });
    expect(plan.kind).toBe("update");
    if (plan.kind !== "update") return;
    expect(plan.addRoleIds).toEqual(["cp-lspd"]);
    expect(plan.removeRoleIds).toEqual(["cp-ems"]);
  });

  it("noops when already in sync", () => {
    const plan = planCpSync({
      userDiscordId: "u",
      isBot: false,
      isOwner: false,
      excludedRoleIds: [],
      incidentRoleIds: ["cp-lspd"],
      memberships: new Map([["guild-lspd", ["src-lspd"]]]),
      links,
      managedTargetRoleIds: managed,
    });
    expect(plan.kind).toBe("noop");
  });
});
