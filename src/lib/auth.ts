import { betterAuth } from "better-auth";
import { admin, magicLink } from "better-auth/plugins";
import { after } from "next/server";
import { database } from "@/lib/database";
import { accessControl, roles } from "@/lib/permissions";
import { sendAccountEmail } from "@/lib/mail";
import { recordVerificationLinkUse } from "@/lib/email-verification";

export const auth = betterAuth({
  database,
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: Number(process.env.ACCOUNT_VERIFY_TTL_SECONDS ?? "3600"),
    sendVerificationEmail: async ({ user, url }) => {
      after(async () => {
        try { await sendAccountEmail(user.email, "Verify your email address", `Verify your account: ${url}`, "verification"); }
        catch { console.error("Account verification email delivery failed."); }
      });
    },
    afterEmailVerification: async (_user, request) => {
      const token = request?.url ? new URL(request.url).searchParams.get("token") : null;
      if (token) recordVerificationLinkUse(token);
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      after(async () => {
        try { await sendAccountEmail(user.email, "Reset your password", `Reset your password: ${url}`, "reset"); }
        catch { console.error("Password reset email delivery failed."); }
      });
    },
  },
  plugins: [
    admin({ ac: accessControl, roles }),
    magicLink({
      disableSignUp: true,
      expiresIn: Number(process.env.ACCOUNT_MAGIC_TTL_SECONDS ?? "300"),
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        const account = database.prepare('SELECT emailVerified, banned FROM "user" WHERE email = ? COLLATE NOCASE')
          .get(email) as { emailVerified: number; banned: number } | undefined;
        if (!account?.emailVerified || account.banned) return;
        after(async () => {
          try { await sendAccountEmail(email, "Your sign-in link", `Sign in to your account: ${url}`, "magic"); }
          catch { console.error("Magic sign-in email delivery failed."); }
        });
      },
    }),
  ],
});
