import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { database } from "@/lib/database";
import { accessControl, roles } from "@/lib/permissions";

export const auth = betterAuth({
  database,
  emailAndPassword: { enabled: true },
  plugins: [admin({ ac: accessControl, roles })],
});
