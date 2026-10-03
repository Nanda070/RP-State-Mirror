/**
 * Runs once when the dashboard server starts. Next.js compiles this file for the edge runtime too,
 * so everything that needs Node.js lives in a separate module loaded only on the Node.js server.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
