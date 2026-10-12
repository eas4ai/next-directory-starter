import "./load-env.mjs";
import { reconcilePurchase, retryRetainedEvidence } from "../src/lib/payment-reconciliation";

function options(args: string[]): { limit: number; purchaseId: string | null; resourceId: string | null } {
  let limit = 10;
  let purchaseId: string | null = null;
  let resourceId: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === "--limit" && value && /^\d+$/.test(value)) limit = Number(value);
    else if (name === "--purchase" && value && /^[0-9a-zA-Z-]{1,100}$/.test(value)) {
      purchaseId = value;
    } else if (name === "--resource" && value && /^[0-9A-Za-z_.:-]{1,200}$/.test(value)) {
      resourceId = value;
    } else throw new Error("Use --limit 1..50 [--purchase ID [--resource PROVIDER_ID]]");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Use --limit 1..50 [--purchase ID [--resource PROVIDER_ID]]");
  }
  if (resourceId && !purchaseId) throw new Error("--resource requires --purchase");
  return { limit, purchaseId, resourceId };
}

async function main() {
  const { limit, purchaseId, resourceId } = options(process.argv.slice(2));
  const retained = retryRetainedEvidence(limit);
  const purchase = purchaseId ? await reconcilePurchase(purchaseId, limit,
    undefined, resourceId ?? undefined) : null;
  process.stdout.write(`${JSON.stringify({ retained, purchase })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Billing reconciliation failed"}\n`);
  process.exitCode = 1;
});
