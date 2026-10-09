import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
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
      await sendAccountEmail(user.email, "Verify your email address", `Verify your account: ${url}`);
    },
  },
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  plugins: [admin({ ac: accessControl, roles })],
});
