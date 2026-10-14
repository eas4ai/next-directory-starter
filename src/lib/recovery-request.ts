type RecoveryRequestInput = { email: string; redirectTo: string };
type RecoveryRequester = (input: RecoveryRequestInput) => Promise<{ error?: unknown }>;

export type RecoveryRequestOutcome =
  | { ok: true; message: string }
  | { ok: false; error: string };

const successMessage = "If that address has an account, a password reset link is on its way.";
const retryMessage = "Unable to send a reset link right now. Try again.";

export async function requestRecoveryEmail(
  request: RecoveryRequester,
  input: RecoveryRequestInput,
): Promise<RecoveryRequestOutcome> {
  try {
    const result = await request(input);
    return result.error
      ? { ok: false, error: retryMessage }
      : { ok: true, message: successMessage };
  } catch {
    return { ok: false, error: retryMessage };
  }
}
