import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, userAc } from "better-auth/plugins/admin/access";

export const accessControl = createAccessControl(defaultStatements);

export const roles = {
  // Application administration uses routes that can audit state changes.
  admin: accessControl.newRole({}),
  user: accessControl.newRole(userAc.statements),
  moderator: accessControl.newRole({}),
  editor: accessControl.newRole({}),
  catalog: accessControl.newRole({}),
  taxonomy: accessControl.newRole({}),
  billing: accessControl.newRole({}),
};
