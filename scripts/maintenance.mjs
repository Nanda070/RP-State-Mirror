// Maintenance switch and health checks for deploy/update.sh.
// Uses the built core package, so every change goes through the same audited code as the dashboard.
//
//   node --env-file=.env scripts/maintenance.mjs on ["reason"]   close bot + site (super admins pass)
//   node --env-file=.env scripts/maintenance.mjs off             open them again
//   node --env-file=.env scripts/maintenance.mjs status          lockdown, bot heartbeat, services
//   node --env-file=.env scripts/maintenance.mjs wait-bot [sec]  wait for a heartbeat newer than now
import { getBotHeartbeat, getLockdown, getSystemStatus, isHeartbeatFresh, setLockdown } from "../packages/core/dist/index.js";
import { prisma } from "../packages/db/dist/index.js";

const [command = "status", argument] = process.argv.slice(2);
const context = { actorType: "SYSTEM", source: "deploy" };
const print = (line) => process.stdout.write(`${line}\n`);

async function status() {
  const lockdown = await getLockdown();
  print(`Техработы: ${lockdown.enabled ? `ВКЛЮЧЕНЫ${lockdown.reason ? ` (${lockdown.reason})` : ""}` : "выключены"}`);
  for (const service of await getSystemStatus()) {
    const mark = service.state === "ok" ? "ok  " : service.state === "down" ? "СБОЙ" : "?   ";
    print(`  [${mark}] ${service.title}: ${service.detail}`);
  }
}

async function waitBot(seconds) {
  const startedAt = Date.now();
  const deadline = startedAt + seconds * 1000;
  while (Date.now() < deadline) {
    const heartbeat = await getBotHeartbeat();
    // A heartbeat written after this check began proves the freshly started process is alive.
    if (heartbeat && heartbeat.at.getTime() >= startedAt && isHeartbeatFresh(heartbeat.at)) {
      print("Бот на связи.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  print(`Бот не вышел на связь за ${seconds} с.`);
  process.exitCode = 1;
}

try {
  switch (command) {
    case "on":
      await setLockdown({ enabled: true, reason: argument ?? "Обновление системы", actorDiscordId: null }, context);
      print("Техработы включены.");
      break;
    case "off":
      await setLockdown({ enabled: false, actorDiscordId: null }, context);
      print("Техработы выключены.");
      break;
    case "status":
      await status();
      break;
    case "wait-bot":
      await waitBot(Number(argument) || 90);
      break;
    default:
      print("usage: maintenance.mjs on [reason] | off | status | wait-bot [seconds]");
      process.exitCode = 2;
  }
} catch (error) {
  print(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
