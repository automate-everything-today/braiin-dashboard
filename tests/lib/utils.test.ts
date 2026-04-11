import { describe, it, expect } from "vitest";
import {
  formatGBP,
  calculateHqFee,
  calculateStaffBonus,
  calculateEbitBonus,
  calculateEquityDividend,
  getClientTier,
  countryFlag,
} from "@/lib/utils";

describe("formatGBP", () => {
  it("formats positive numbers", () => {
    expect(formatGBP(1234)).toBe("£1,234");
  });
  it("formats zero", () => {
    expect(formatGBP(0)).toBe("£0");
  });
  it("formats negative numbers", () => {
    expect(formatGBP(-500)).toBe("-£500");
  });
  it("rounds to whole pounds", () => {
    expect(formatGBP(1234.56)).toBe("£1,235");
  });
});

describe("calculateHqFee", () => {
  it("waives fee for zero GP", () => {
    expect(calculateHqFee(0)).toBe(0);
  });
  it("waives fee for negative GP", () => {
    expect(calculateHqFee(-100)).toBe(0);
  });
  it("splits 50/50 for GP £1-150", () => {
    expect(calculateHqFee(100)).toBe(50);
    expect(calculateHqFee(150)).toBe(75);
  });
  it("charges flat ops fee for GP £151-1000", () => {
    expect(calculateHqFee(200)).toBe(150);
    expect(calculateHqFee(500)).toBe(150);
    expect(calculateHqFee(1000)).toBe(150);
  });
  it("charges 15% for GP £1001-3000", () => {
    expect(calculateHqFee(1500)).toBe(225);
    expect(calculateHqFee(3000)).toBe(450);
  });
  it("charges 17.5% for GP £3001-5000", () => {
    expect(calculateHqFee(4000)).toBe(700);
    expect(calculateHqFee(5000)).toBe(875);
  });
  it("charges 20% for GP £5001+", () => {
    expect(calculateHqFee(10000)).toBe(2000);
    expect(calculateHqFee(25000)).toBe(5000);
  });
  it("uses custom ops fee", () => {
    expect(calculateHqFee(500, 125)).toBe(125);
  });
});

describe("calculateStaffBonus", () => {
  it("calculates base staff T1 (1x monthly)", () => {
    expect(calculateStaffBonus(3000, 1.0)).toBe(3000);
  });
  it("calculates base staff T2 (1.25x monthly)", () => {
    expect(calculateStaffBonus(3000, 1.25)).toBe(3750);
  });
  it("calculates manager T3 (2x monthly)", () => {
    expect(calculateStaffBonus(4000, 2.0)).toBe(8000);
  });
});

describe("calculateEbitBonus", () => {
  it("returns zero below threshold", () => {
    const result = calculateEbitBonus(200000);
    expect(result.bonusPool).toBe(0);
    expect(result.perPerson).toBe(0);
  });
  it("calculates 50% of EBIT above £300k", () => {
    const result = calculateEbitBonus(500000);
    expect(result.bonusPool).toBe(100000);
    expect(result.perPerson).toBe(50000);
  });
  it("works with custom threshold", () => {
    const result = calculateEbitBonus(500000, 400000);
    expect(result.bonusPool).toBe(50000);
    expect(result.perPerson).toBe(25000);
  });
});

describe("calculateEquityDividend", () => {
  it("calculates 7.5% of EBIT", () => {
    expect(calculateEquityDividend(1000000)).toBe(75000);
  });
  it("returns zero for negative EBIT", () => {
    expect(calculateEquityDividend(-50000)).toBe(0);
  });
  it("works with custom percentage", () => {
    expect(calculateEquityDividend(1000000, 0.15)).toBe(150000);
  });
});

describe("getClientTier", () => {
  it("returns Platinum for £10k+", () => {
    expect(getClientTier(15000)).toBe("Platinum");
  });
  it("returns Gold for £5k-10k", () => {
    expect(getClientTier(7000)).toBe("Gold");
  });
  it("returns Silver for £2k-5k", () => {
    expect(getClientTier(3000)).toBe("Silver");
  });
  it("returns Bronze for £500-2k", () => {
    expect(getClientTier(800)).toBe("Bronze");
  });
  it("returns Starter for under £500", () => {
    expect(getClientTier(100)).toBe("Starter");
  });
});

describe("countryFlag", () => {
  it("returns UK flag", () => {
    expect(countryFlag("UK")).not.toBe("");
  });
  it("returns empty for unknown country", () => {
    expect(countryFlag("Narnia")).toBe("");
  });
});
