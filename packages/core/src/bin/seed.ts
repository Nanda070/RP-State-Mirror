import { prisma } from "@mirror/db";
import { baseEnvSchema, parseEnv } from "../env.js";
import { createLogger } from "../logger.js";
import { seedFoundation } from "../seed.js";

const env = parseEnv(baseEnvSchema);
const log = createLogger("seed", env.LOG_LEVEL);

try {
  const result = await seedFoundation({ superAdminUserIds: env.SUPER_ADMIN_USER_IDS });
  log.info(result, "seed completed");
} catch (error) {
  log.error({ err: error }, "seed failed");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
