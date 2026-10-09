import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { after } from "next/server";
import { database } from "@/lib/database";
import { accessControl, roles } from "@/lib/permissions";
import { sendAccountEmail } from "@/lib/mail";

export const auth = betterAuth({
  database,
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: Number(process.env.ACCOUNT_VERIFY_TTL_SECONDS ?? "3600"),
    sendVerificationEmail: async ({ user, url }) => {
      after(async () => {
        try { await sendAccountEmail(user.email, "Verify your email address", `Verify your account: ${url}`); }
        catch { console.error("Account verification email delivery failed."); }
      });
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      after(async () => {
        try { await sendAccountEmail(user.email, "Reset your password", `Reset your password: ${url}`); }
        catch { console.error("Password reset email delivery failed."); }
      });
    },
  },
  plugins: [admin({ ac: accessControl, roles })],
});
