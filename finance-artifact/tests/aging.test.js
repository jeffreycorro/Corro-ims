"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { AP_BUCKETS, apBucket, billRemaining, caBucket, classifyBill, dueThisWeek } = require("../netlify/lib/aging");
const { addDays } = require("../netlify/lib/manila");

describe("AP aging", () => {
  const today = "2026-10-10";

  it("keeps a bill due today in current", () => {
    assert.equal(apBucket(0), "current");
    assert.equal(apBucket(-3), "current");
  });

  it("places past-due days in the stated buckets", () => {
    assert.equal(apBucket(1), "1-30");
    assert.equal(apBucket(30), "1-30");
    assert.equal(apBucket(31), "31-60");
    assert.equal(apBucket(60), "31-60");
    assert.equal(apBucket(61), "61-90");
    assert.equal(apBucket(90), "61-90");
    assert.equal(apBucket(91), "90+");
  });

  it("ages a September bill into 31-60 on 10 October", () => {
    const info = classifyBill(
      { net_amount: 1110, due_date: "2026-09-01", status: "Open", paid_amount: 0 },
      [],
      "2026-10-09"
    );
    assert.equal(info.daysPastDue, 38);
    assert.equal(info.bucket, "31-60");
    assert.equal(info.remaining, 1110);
  });

  it("reduces the remaining balance by partial payments", () => {
    const money = billRemaining({ net_amount: 1110 }, [{ amount: 400 }, { amount: 100, voided: true }]);
    assert.equal(money.paid, 400);
    assert.equal(money.remaining, 710);
  });

  it("lists a bill due within the next seven days", () => {
    const bill = { net_amount: 500, due_date: addDays(today, 6), status: "Open" };
    assert.equal(dueThisWeek(bill, [], today), true);
    assert.equal(dueThisWeek({ ...bill, due_date: addDays(today, 7) }, [], today), false);
    assert.equal(dueThisWeek({ ...bill, status: "Paid" }, [{ amount: 500 }], today), false);
  });

  it("uses the same bucket names the screen prints", () => {
    assert.deepEqual(AP_BUCKETS, ["current", "1-30", "31-60", "61-90", "90+"]);
    assert.equal(caBucket(0), "0-30");
    assert.equal(caBucket(91), "90+");
  });
});
