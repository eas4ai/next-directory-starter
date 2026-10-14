type RecoveryRequestInput = { email: string; redirectTo: string };
type RecoveryRequester = (input: RecoveryRequestInput) => Promise<{ error?: unknown }>;

export type RecoveryRequestOutcome = { message: string; error: string };

const successMessage = "If that address has an account, a password reset link is on its way.";
const retryMessage = "Unable to send a reset link right now. Try again.";

export async function requestRecoveryEmail(
  request: RecoveryRequester,
  input: RecoveryRequestInput,
): Promise<RecoveryRequestOutcome> {
  try {
    const result = await request(input);
    return result.error
      ? { message: "", error: retryMessage }
      : { message: successMessage, error: "" };
  } catch {
    return { message: "", error: retryMessage };
  }
}
