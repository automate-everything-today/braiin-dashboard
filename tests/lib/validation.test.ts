import { describe, it, expect } from "vitest";
import { accountSchema, messageSchema, incidentSchema, apiResponse, apiError } from "@/lib/validation";

describe("accountSchema", () => {
  it("validates a valid account", () => {
    const result = accountSchema.safeParse({
      company_name: "Maersk",
      relationship_types: ["supplier"],
      service_categories: ["shipping_line"],
      financial_direction: "payable",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing company_name", () => {
    const result = accountSchema.safeParse({ relationship_types: ["supplier"] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid relationship_type", () => {
    const result = accountSchema.safeParse({
      company_name: "Test",
      relationship_types: ["invalid_type"],
    });
    expect(result.success).toBe(false);
  });

  it("allows multiple relationship types", () => {
    const result = accountSchema.safeParse({
      company_name: "DHL",
      relationship_types: ["direct_client", "supplier"],
      service_categories: ["courier", "road_haulier"],
      financial_direction: "both",
    });
    expect(result.success).toBe(true);
  });
});

describe("messageSchema", () => {
  it("validates a valid message", () => {
    const result = messageSchema.safeParse({
      content: "Can you chase this? @sam",
      context_type: "email",
      context_id: "AAMkAGI2",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty content", () => {
    const result = messageSchema.safeParse({ content: "", context_type: "email" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid context_type", () => {
    const result = messageSchema.safeParse({ content: "hello", context_type: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("incidentSchema", () => {
  it("validates a valid incident", () => {
    const result = incidentSchema.safeParse({
      severity: "amber",
      title: "Delayed shipment",
      category: "delay",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid severity", () => {
    const result = incidentSchema.safeParse({ severity: "green", title: "Test", category: "delay" });
    expect(result.success).toBe(false);
  });

  it("validates a black incident with financial fields", () => {
    const result = incidentSchema.safeParse({
      severity: "black",
      title: "Failure to pay - ABC Logistics",
      category: "failure_to_pay",
      account_code: "ABCLOG",
      financial_impact: 50000,
    });
    expect(result.success).toBe(true);
  });
});

describe("apiResponse / apiError", () => {
  it("creates a success response", () => {
    const res = apiResponse({ id: 1 });
    expect(res.status).toBe(200);
  });

  it("creates an error response", () => {
    const res = apiError("Not found", 404);
    expect(res.status).toBe(404);
  });
});
