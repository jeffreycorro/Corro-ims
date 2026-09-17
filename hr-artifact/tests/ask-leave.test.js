"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const hrAskLeave = require("../public/hr-ask-leave");

describe("hr ask leave payload", () => {
  it("reads Reason for Leave from reason and common aliases", () => {
    assert.equal(hrAskLeave.leaveReason({ reason: "Medical check-up in Cebu" }), "Medical check-up in Cebu");
    assert.equal(
      hrAskLeave.leaveReason({ reasonForLeave: "Family emergency" }),
      "Family emergency"
    );
    assert.equal(hrAskLeave.leaveReason({ notes: "Imported from the signed form" }), "");
    assert.equal(hrAskLeave.leaveReason({ notes: "Covering the Barili pour" }), "Covering the Barili pour");
    assert.equal(hrAskLeave.leaveReason({ reason: "" }), "");
  });

  it("serializes type, dates, status, and reason for Ask tools", () => {
    const row = hrAskLeave.serializeLeave(
      {
        no: "LRF2026-0170",
        type: "LWOP",
        from: "2026-09-16",
        to: "2026-09-17",
        days: 2,
        status: "Approved",
        reason: "Personal matters in Cebu",
        filedOn: "2026-09-15",
      },
      { leaveType: () => ({ n: "Leave Without Pay" }) }
    );
    assert.equal(row.no, "LRF2026-0170");
    assert.equal(row.typeName, "Leave Without Pay");
    assert.equal(row.from, "2026-09-16");
    assert.equal(row.status, "Approved");
    assert.equal(row.reason, "Personal matters in Cebu");
    assert.equal(row.reasonOnForm, true);
  });

  it("returns Catherine Largo's leave with the form reason", () => {
    const leaves = [
      {
        empId: "eL",
        no: "LRF2026-0170",
        type: "LWOP",
        from: "2026-09-16",
        to: "2026-09-16",
        days: 1,
        status: "Filed",
        reason: "Attend to family in Cebu",
      },
    ];
    const out = hrAskLeave.leavesForEmployee(leaves, "eL", {
      leaveType: () => ({ n: "Leave Without Pay" }),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].reason, "Attend to family in Cebu");
    assert.equal(out[0].reasonOnForm, true);
  });

  it("tells the model to report the leave-form reason", () => {
    assert.match(hrAskLeave.ASK_LEAVE_RULE, /Reason for Leave/);
    assert.match(hrAskLeave.ASK_LEAVE_RULE, /leave_for/);
  });
});

describe("Ask the records artifact leave wiring", () => {
  it("offers leave_for and names reason in money_for", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /name:"leave_for"/);
    assert.match(html, /Reason for Leave/);
    assert.match(html, /reasonOnForm/);
    assert.match(html, /hrAskLeave/);
    assert.match(html, /id="ask-attach"/);
    assert.match(html, /id="ask-files"/);
    assert.match(html, /id="ask-q"/);
    assert.match(html, /Looking up the records/);
  });
});
