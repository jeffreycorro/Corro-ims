"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createAdvance, createVoucher, saveProject, seedReference, transitionAdvance, transitionVoucher } = require("../netlify/lib/domain");
const { createMemoryStore } = require("../netlify/lib/memory-store");
const { formatNumber } = require("../netlify/lib/numbering");

async function storeWithProject() {
  const store = createMemoryStore();
  await seedReference(store);
  await saveProject(store, { name: "Tower A", site: "Cebu" });
  return store;
}

function ctx(extra) {
  return Object.assign(
    { name: "Ana Cruz", today: "2026-10-10", now: "2026-10-10T09:00:00+08:00", approverOk: true },
    extra
  );
}

describe("numbering", () => {
  it("formats a year series with four digits", () => {
    assert.equal(formatNumber("DV", 2026, 1), "DV2026-0001");
    assert.equal(formatNumber("CA", 2026, 42), "CA2026-0042");
    assert.equal(formatNumber("AP", 2026, 10000), "AP2026-10000");
  });

  it("assigns a unique DV number per save, including concurrent creates", async () => {
    const store = await storeWithProject();
    const made = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        createVoucher(
          store,
          {
            payee: "Supplier " + index,
            projectName: "Tower A",
            particulars: "Materials " + index,
            accountName: "Materials",
            amount: 100 + index,
            vatMode: "none",
          },
          ctx()
        )
      )
    );
    const numbers = made.map((row) => row.dv_no);
    assert.equal(new Set(numbers).size, 20);
    const seqs = made.map((row) => row.seq).sort((a, b) => a - b);
    assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1));
    assert.ok(numbers.every((no) => /^DV2026-\d{4,}$/.test(no)));
  });

  it("does not reuse a number after the voucher is cancelled", async () => {
    const store = await storeWithProject();
    const first = await createVoucher(
      store,
      { payee: "A", projectName: "Tower A", particulars: "One", accountName: "Materials", amount: 10, vatMode: "none" },
      ctx()
    );
    await transitionVoucher(store, first.id, "cancel", {}, ctx());
    const second = await createVoucher(
      store,
      { payee: "B", projectName: "Tower A", particulars: "Two", accountName: "Materials", amount: 10, vatMode: "none" },
      ctx()
    );
    assert.notEqual(second.dv_no, first.dv_no);
    assert.equal(second.seq, first.seq + 1);
  });

  it("keeps cash advance numbers on their own series", async () => {
    const store = await storeWithProject();
    const voucher = await createVoucher(
      store,
      { payee: "A", projectName: "Tower A", particulars: "One", accountName: "Materials", amount: 10, vatMode: "none" },
      ctx()
    );
    const advance = await createAdvance(
      store,
      {
        employeeName: "Ben Cruz",
        department: "site",
        purpose: "Fuel",
        projectName: "Tower A",
        amount: 500,
        dateNeeded: "2026-10-12",
      },
      ctx()
    );
    assert.equal(voucher.dv_no, "DV2026-0001");
    assert.equal(advance.ca_no, "CA2026-0001");
    const again = await transitionAdvance(store, advance.id, "submit", {}, ctx());
    assert.equal(again.ca_no, advance.ca_no);
  });
});
