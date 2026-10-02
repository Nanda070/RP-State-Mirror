import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function setup() {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? "postgresql://mirror_test:mirror_test_password@localhost:55432/mirror_test";
  execSync("pnpm exec prisma migrate deploy", {
    cwd: fileURLToPath(new URL("../packages/db", import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}
