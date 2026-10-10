import "./load-env.mjs";
import { deliverOwnerNotifications } from "../src/lib/notification-delivery";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--limit" || !/^\d+$/.test(args[1])) {
    throw new Error("Usage: npm run notifications:deliver -- --limit 10");
  }
  const limit = Number(args[1]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Notification limit must be between 1 and 50");
  }
  const result = await deliverOwnerNotifications({ limit });
  process.stdout.write(`Notifications attempted: ${result.attempted}, sent: ${result.sent}, failed: ${result.failed}\n`);
}

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : "Notification worker failed\n");
  process.exitCode = 1;
});
