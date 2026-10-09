import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";

export const accessControl = createAccessControl(defaultStatements);

export const roles = {
  admin: accessControl.newRole(adminAc.statements),
  user: accessControl.newRole(userAc.statements),
  moderator: accessControl.newRole({}),
};
