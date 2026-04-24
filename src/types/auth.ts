import { AccessRole } from "./staff";

export type DataScope = "all" | "branch" | "assigned";

export interface Session {
  authenticated: boolean;
  email: string;
  name: string;
  role: AccessRole;
  department: string;
  branch: string;
  is_staff: boolean;
  staff_id: number | null;
  page_access: string[];
}

export interface QueryContext {
  userId: number | null;
  branchId: string;
  scope: DataScope;
  role: AccessRole;
}
