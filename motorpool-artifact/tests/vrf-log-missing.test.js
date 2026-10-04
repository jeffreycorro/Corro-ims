"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  heldReserveVrfs,
  ledgerReplaceBase,
  mergeLedgerRows,
  postedLogTotal,
  reopenClosedLedgerRow,
  reserveReplaceBase,
  vrfLogAmount,
  vrfLogVisible,
  vrfCountsTowardPostedTotal,
} = require("./lib/rules");

function dup5903() {
  return {
    vrf: "5903",
    date: "2026-09-28",
    veh: "MC-21",
    item: "Fuel",
    qty: 0,
    price: 0,
    total: 0,
    vstatus: "Duplicate",
    liq: { at: "2026-09-30", by: "Brinneshiel", outcome: "duplicate", duplicateOf: "5890" },
    audit: [
      {
        at: "2026-09-30",
        by: "Brinneshiel",
        field: "duplicate",
        from: "5903",
        to: "Duplicate of VRF 5890",
      },
    ],
  };
}

describe("VRF Logs keeps 5902 and 5903", () => {
  it("lists every VRF number, including a duplicate and a FOR APPROVAL hold past the old cutoff", () => {
    const holds = Array.from({ length: 320 }, (_, i) => ({
      vrf: String(2000 + i),
      held: true,
      status: "Requested",
      date: "2026-08-01",
      total: 100,
    }));
    const list = holds.concat([
      { vrf: "5903", status: "Duplicate", duplicateOf: "5890", date: "2026-09-28", total: 0 },
      { vrf: "5902", status: "Requested", held: true, date: "2026-09-26", total: 250 },
      { vrf: "5890", status: "Closed", date: "2026-09-28", total: 150 },
      { vrf: "1001", status: "Legacy", date: "2024-01-01", total: 80 },
    ]);
    const visible = vrfLogVisible(list, 8000);
    ["5903", "5902", "5890", "1001"].forEach((no) => {
      assert.ok(visible.some((v) => v.vrf === no), no + " is on the log");
    });
    assert.equal(visible.length, list.length);
    assert.equal(visible[0].vrf, "5903");
  });

  it("shows a duplicate at zero and leaves a pending form out of the posted total", () => {
    const rows = [
      { vrf: "5890", status: "Closed", total: 150 },
      { vrf: "5903", status: "Duplicate", duplicateOf: "5890", total: 200 },
      { vrf: "5902", status: "Requested", total: 250 },
      { vrf: "5888", status: "Open", total: 40 },
    ];
    assert.equal(vrfLogAmount(rows[1]), 0);
    assert.equal(vrfCountsTowardPostedTotal(rows[1]), false);
    assert.equal(vrfCountsTowardPostedTotal(rows[2]), false);
    assert.equal(postedLogTotal(rows), 190);
  });

  it("still surfaces a number that is only on a reserve's vrfs list", () => {
    assert.deepEqual(
      heldReserveVrfs(
        [{ no: "56", vrfNo: "5890", vrfs: ["5890", "5903"], status: "Approved" }],
        [{ vrf: "5890" }]
      ),
      ["5903"]
    );
    assert.deepEqual(
      heldReserveVrfs(
        [{ no: "70", vrfNo: "5902", status: "Requested", draftLines: [{ cat: "Fuel — Gasoline", qty: 1, price: 250 }] }],
        [{ vrf: "5890" }]
      ),
      ["5902"]
    );
  });
});

describe("reopening 5890 does not drop 5903 or any other row", () => {
  it("replaces only 5890 in the month", () => {
    const other = { vrf: "5902", veh: "MC-07", total: 250, vstatus: "Open" };
    const dup = dup5903();
    const before = JSON.parse(JSON.stringify(dup));
    const closed = {
      vrf: "5890",
      veh: "MC-21",
      total: 200,
      vstatus: "Closed",
      liq: { at: "2026-10-01", by: "Brinneshiel", outcome: "bought" },
    };
    const opened = reopenClosedLedgerRow(closed, "Brinneshiel", "2026-10-02", 200, closed.liq);
    const month = mergeLedgerRows([other, dup, closed], "5890", [opened], "replace");
    assert.equal(month.filter((row) => row.vrf === "5890").length, 1);
    assert.equal(month.find((row) => row.vrf === "5890").vstatus, "Open");
    assert.deepEqual(month.find((row) => row.vrf === "5903"), before);
    assert.equal(month.find((row) => row.vrf === "5902").veh, "MC-07");
    assert.equal(month.find((row) => row.vrf === "5902").total, 250);
  });

  it("refuses to write the month when the re-read lost the other VRFs", () => {
    const local = [dup5903(), { vrf: "5890", total: 200 }, { vrf: "5902", total: 250 }];
    assert.throws(
      () => ledgerReplaceBase(null, local, "5890"),
      (err) => err.code === "ledger_unreadable"
    );
    assert.throws(
      () => ledgerReplaceBase([{ vrf: "5890", total: 150 }], local, "5890"),
      (err) => err.code === "ledger_unreadable"
    );
    const server = [dup5903(), { vrf: "5890", total: 200 }, { vrf: "5902", total: 250 }];
    assert.equal(ledgerReplaceBase(server, local, "5890"), server);
    assert.deepEqual(ledgerReplaceBase(null, [{ vrf: "5890" }], "5890"), []);
  });

  it("refuses to write the reserve year when the re-read lost the other reserves", () => {
    const local = [
      { no: "56", vrfNo: "5890" },
      { no: "70", vrfNo: "5902" },
      { no: "71", vrfNo: "5903" },
    ];
    assert.throws(
      () => reserveReplaceBase(null, local, ["56"]),
      (err) => err.code === "ledger_unreadable"
    );
    assert.throws(
      () => reserveReplaceBase([{ no: "56", vrfNo: "5890" }], local, ["56"]),
      (err) => err.code === "ledger_unreadable"
    );
    const server = local.slice();
    assert.equal(reserveReplaceBase(server, local, ["56"]), server);
  });
});

describe("artifact HTML — VRF log shows every number", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("keeps the search, the badges, and the guard against a short re-read", () => {
    assert.match(html, /var BUILD = "2026-10-04 a"/);
    assert.match(html, /placeholder="VRF number, unit, item, supplier…"/);
    assert.match(html, /var numberQuery=/);
    assert.match(html, /function vrfLogStatus/);
    assert.match(html, /"FOR APPROVAL"/);
    assert.match(html, /Duplicate of "/);
    assert.match(html, /function ledgerReplaceBase/);
    assert.match(html, /function reserveReplaceBase/);
    assert.match(html, /function heldVrfShell/);
    assert.match(html, /tr\.vrf-dup/);
    assert.match(html, /posted spend — duplicates and FOR APPROVAL excluded/);
    assert.doesNotMatch(html, /kept\.length>=300/);
    assert.doesNotMatch(html, /cur-40/);
    const logStart = html.indexOf("function vrfLogView");
    const logEnd = html.indexOf("/* ---- job & parts history", logStart);
    const log = html.slice(logStart, logEnd);
    assert.match(log, /get:vrfLogStatus/);
    assert.match(log, /rowClass:function\(v\)\{ return v&&v\.status==="Duplicate"\?"vrf-dup":""; \}/);
  });
});
