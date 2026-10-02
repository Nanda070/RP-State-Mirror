import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://mirror_test:mirror_test_password@localhost:55432/mirror_test";

export default defineConfig({
  resolve: {
    alias: {
      "@mirror/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      "@mirror/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL, APP_ENV: "test", LOG_LEVEL: "silent" },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
