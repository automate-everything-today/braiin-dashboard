export type AccessRole = "super_admin" | "admin" | "branch_md" | "manager" | "sales_rep" | "ops" | "accounts" | "viewer";

export interface Staff {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  branch: string;
  salary: number;
  new_salary: number;
  nic: number;
  pension: number;
  professional_fees: number;
  overseas_tax: number;
  monthly_cost: number;
  fte_pct: number;
  contract_type: "paye" | "contract";
  is_manager: boolean;
  bonus_eligible: boolean;
  bonus_t1: number;
  bonus_t2: number;
  bonus_t3: number;
  access_role: AccessRole;
  page_access: string[];
  country: string;
  is_remote: boolean;
  is_active: boolean;
  notes: string;
  start_date: string | null;
  end_date: string | null;
}

export interface BonusConfig {
  id: number;
  year: number;
  staff_t1: number;
  staff_t2: number;
  staff_t3: number;
  manager_t1: number;
  manager_t2: number;
  manager_t3: number;
}
