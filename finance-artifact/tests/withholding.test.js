"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeWithholding, peso, round2 } = require("../netlify/lib/money");

describe("withholding", () => {
  it("splits VAT-inclusive 1,120 into base, 12% VAT, and 1% EWT", () => {
    const tax = computeWithholding({ amount: 1120, vatMode: "inclusive", vatRate: 0.12, ewtRate: 0.01 });
    assert.equal(tax.vatable, 1000);
    assert.equal(tax.vat, 120);
    assert.equal(tax.gross, 1120);
    assert.equal(tax.ewt, 10);
    assert.equal(tax.net, 1110);
  });

  it("adds VAT when the typed amount is exclusive", () => {
    const tax = computeWithholding({ amount: 1000, vatMode: "exclusive", vatRate: 0.12, ewtRate: 0.01 });
    assert.equal(tax.vatable, 1000);
    assert.equal(tax.vat, 120);
    assert.equal(tax.gross, 1120);
    assert.equal(tax.ewt, 10);
    assert.equal(tax.net, 1110);
  });

  it("withholds from a non-VAT amount", () => {
    const tax = computeWithholding({ amount: 1000, vatMode: "none", ewtRate: 0.02 });
    assert.equal(tax.vat, 0);
    assert.equal(tax.ewt, 20);
    assert.equal(tax.net, 980);
  });

  it("rounds an inclusive amount that does not divide evenly", () => {
    const tax = computeWithholding({ amount: 1000, vatMode: "inclusive", vatRate: 0.12, ewtRate: 0 });
    assert.equal(tax.vatable, 892.86);
    assert.equal(tax.vat, 107.14);
    assert.equal(tax.gross, 1000);
    assert.equal(round2(tax.vatable + tax.vat), 1000);
  });

  it("formats pesos with the symbol and two decimals", () => {
    assert.equal(peso(1234.5), "₱1,234.50");
    assert.equal(peso(0), "₱0.00");
    assert.equal(peso(-2), "-₱2.00");
  });
});
