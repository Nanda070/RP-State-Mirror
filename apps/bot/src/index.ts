import { prisma } from "@mirror/db";

async function main() {
  await prisma.$connect();
  console.log("Mirror bot foundation is ready; Discord handlers are implemented in a later stage.");
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});