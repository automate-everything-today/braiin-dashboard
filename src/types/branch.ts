export type FeeModel = "hq_ops" | "own_ops";

export interface Branch {
  id: number;
  name: string;
  code: string;
  city: string;
  country: string;
  fee_model: FeeModel;
  ops_fee_per_job: number;
  gp_percentage: number;
  warehouse_gp_percentage: number;
  software_fee_per_user: number;
  is_active: boolean;
}
