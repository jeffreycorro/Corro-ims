"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  canReadHrLeaves,
  empMatch,
  leaveReason,
  lookupLeaves,
  serializeLeave,
} = require("../netlify/lib/hr-leave-lookup");

describe("motorpool HR leave lookup", () => {
  it("allows only admin / HR sessions", () => {
    assert.equal(canReadHrLeaves({ role: "admin" }), true);
    assert.equal(canReadHrLeaves({ role: "hr" }), true);
    assert.equal(canReadHrLeaves({ department: "hr" }), true);
    assert.equal(canReadHrLeaves({ role: "staff", department: "motorpool" }), false);
    assert.equal(canReadHrLeaves({ sub: "open", method: "open" }), false);
  });

  it("matches Catherine Largo / emp 1282 loose names", () => {
    const emp = { empNo: "1282", name: "Largo, Catherine A." };
    assert.equal(empMatch(emp, "Catherine Largo"), true);
    assert.equal(empMatch(emp, "1282"), true);
    assert.equal(empMatch(emp, "largo"), true);
    assert.equal(empMatch(emp, "Glory Mae"), false);
  });

  it("keeps the leave-form reason on the serialized row", () => {
    const row = serializeLeave({
      no: "LRF2026-0170",
      type: "LWOP",
      from: "2026-09-16",
      reason: "Attend to family in Cebu",
      status: "Filed",
    });
    assert.equal(row.reason, "Attend to family in Cebu");
    assert.equal(row.reasonOnForm, true);
    assert.equal(leaveReason({ notes: "Imported from the signed form" }), "");
  });

  it("returns type, dates, status, and reason from HR docs", async () => {
    const rest = async ({ query }) => {
      if (String(query).includes("collection=eq.employees")) {
        return [
          { id: "eL", data: { id: "eL", empNo: "1282", name: "Largo, Catherine A." } },
        ];
      }
      return [
        {
          id: "lvL",
          data: {
            empId: "eL",
            no: "LRF2026-0170",
            type: "LWOP",
            from: "2026-09-16",
            to: "2026-09-16",
            days: 1,
            status: "Approved",
            reason: "Attend to family in Cebu",
          },
        },
      ];
    };
    const out = await lookupLeaves("Catherine Largo", { rest });
    assert.equal(out.available, true);
    assert.equal(out.employee.empNo, "1282");
    assert.equal(out.leave.length, 1);
    assert.equal(out.leave[0].reason, "Attend to family in Cebu");
    assert.equal(out.leave[0].status, "Approved");
    assert.match(out.note, /Reason for Leave/);
  });
});
