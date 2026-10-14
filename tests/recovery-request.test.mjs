import assert from 'node:assert/strict';
import test from 'node:test';

import { requestRecoveryEmail } from '../src/lib/recovery-request.ts';

const input = {
  email: 'owner@example.invalid',
  redirectTo: 'https://directory.example/owner/reset-password',
};

test('password recovery distinguishes accepted requests from account-neutral failures', async () => {
  const accepted = await requestRecoveryEmail(async () => ({ data: {}, error: null }), input);
  assert.deepEqual(accepted, {
    ok: true,
    message: 'If that address has an account, a password reset link is on its way.',
  });

  const limited = await requestRecoveryEmail(async () => ({
    data: null,
    error: { status: 429, message: 'Too many requests' },
  }), input);
  assert.deepEqual(limited, {
    ok: false,
    error: 'Unable to send a reset link right now. Try again.',
  });

  const disconnected = await requestRecoveryEmail(async () => {
    throw new Error('provider details must remain private');
  }, input);
  assert.deepEqual(disconnected, {
    ok: false,
    error: 'Unable to send a reset link right now. Try again.',
  });
});
