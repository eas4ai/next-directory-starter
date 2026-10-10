import { reconcilePurchase, retryRetainedEvidence } from "../src/lib/payment-reconciliation";

function options(args: string[]): { limit: number; purchaseId: string | null } {
  let limit = 10;
  let purchaseId: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === "--limit" && value && /^\d+$/.test(value)) limit = Number(value);
    else if (name === "--purchase" && value && /^[0-9a-zA-Z-]{1,100}$/.test(value)) {
      purchaseId = value;
    } else throw new Error("Use --limit 1..50 [--purchase ID]");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Use --limit 1..50 [--purchase ID]");
  }
  return { limit, purchaseId };
}

async function main() {
  const { limit, purchaseId } = options(process.argv.slice(2));
  const retained = retryRetainedEvidence(limit);
  const purchase = purchaseId ? await reconcilePurchase(purchaseId, limit) : null;
  process.stdout.write(`${JSON.stringify({ retained, purchase })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Billing reconciliation failed"}\n`);
  process.exitCode = 1;
});
