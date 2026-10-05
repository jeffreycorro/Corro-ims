"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  mergeLedgerRows,
  reservesClaimingVrf,
  shouldRemintHeldVrf,
  holdIsSealed,
  closedLedgerLinesFromHold,
  headerAuditNotes,
  applyVrfHeaderPatch,
  applyVrfAutoApproval,
  VRF_AUTO_APPROVE_UNDER,
} = require("./lib/rules");

function mc14() {
  return {
    vrf: "5864",
    veh: "MC-14",
    name: "YAMAHA MIO 125 (ORANGE/WHITE)",
    odo: 28935,
    project: "UP- She Shelter",
    cat: "Fuel — Gasoline",
    item: "Fuel",
    supplier: "Iced Petron",
    qty: 1,
    price: 150,
    total: 150,
    work: "FUEL-STN",
    date: "2026-09-25",
    month: "2026-09",
    vstatus: "Open",
    reserve: "14",
  };
}

function sv09() {
  return {
    vrf: "5881",
    veh: "SV-09",
    odo: 204707,
    project: "",
    cat: "Fuel — Diesel",
    item: "Fuel reserve dispense",
    supplier: "FUEL RESERVE",
    qty: 1,
    price: 1690,
    total: 1690,
    work: "FUEL-RES",
    date: "2026-09-25",
    month: "2026-09",
    vstatus: "Open",
    reserve: "9",
  };
}

describe("VRF 5864 must not take on VRF 5881", () => {
  it("keeps the other VRF byte-identical after liquidate and odometer saves", () => {
    let month = [];
    month = mergeLedgerRows(month, "5864", [mc14()], "append");
    month = mergeLedgerRows(month, "5881", [sv09()], "append");
    const svBefore = JSON.parse(JSON.stringify(month.find((r) => r.vrf === "5881")));

    const closed = Object.assign({}, mc14(), { price: 150.11, total: 150.11, vstatus: "Closed" });
    month = mergeLedgerRows(month, "5864", [closed], "replace");
    assert.deepEqual(month.find((r) => r.vrf === "5881"), svBefore);
    assert.equal(month.find((r) => r.vrf === "5864").veh, "MC-14");
    assert.equal(month.find((r) => r.vrf === "5864").supplier, "Iced Petron");
    assert.equal(month.find((r) => r.vrf === "5864").total, 150.11);

    const mcBefore = JSON.parse(JSON.stringify(month.find((r) => r.vrf === "5864")));
    const svOdo = Object.assign({}, svBefore, { odo: 204800 });
    month = mergeLedgerRows(month, "5881", [svOdo], "replace");
    assert.deepEqual(month.find((r) => r.vrf === "5864"), mcBefore);
    assert.equal(month.find((r) => r.vrf === "5881").odo, 204800);
    assert.equal(month.find((r) => r.vrf === "5881").veh, "SV-09");
  });

  it("does not let a stale device write replace the other VRF", () => {
    const server = [mc14(), sv09()];
    const svBefore = JSON.parse(JSON.stringify(server[1]));
    const staleMemory = [
      {
        vrf: "5864",
        veh: "SV-09",
        odo: 204707,
        item: "Fuel reserve dispense",
        supplier: "FUEL RESERVE",
        total: 150.11,
      },
    ];
    const odoSave = Object.assign({}, server[0], { odo: 29000 });
    const written = mergeLedgerRows(server, "5864", [odoSave], "replace");
    assert.deepEqual(written.find((r) => r.vrf === "5881"), svBefore);
    assert.equal(written.find((r) => r.vrf === "5864").veh, "MC-14");
    assert.equal(written.find((r) => r.vrf === "5864").odo, 29000);
    assert.notEqual(written.find((r) => r.vrf === "5864").veh, staleMemory[0].veh);
    assert.equal(written.filter((r) => r.vrf === "5881").length, 1);
  });

  it("refuses to write a row whose VRF number is not the one being saved", () => {
    assert.throws(
      () => mergeLedgerRows([mc14()], "5864", [sv09()], "replace"),
      (err) => err.code === "vrf_mismatch"
    );
  });

  it("does not copy another reserve's draft line onto this VRF by array index", () => {
    const lines = closedLedgerLinesFromHold(
      {
        vrf: "5864",
        veh: "MC-14",
        date: "2026-09-25",
        odo: 28935,
        rows: [
          {
            vrf: "5864",
            veh: "MC-14",
            cat: "Fuel — Gasoline",
            item: "Fuel",
            supplier: "Iced Petron",
            qty: 1,
            price: 150,
            total: 150,
            work: "FUEL-STN",
          },
        ],
      },
      [{ qty: 1, price: 150.11 }],
      { at: "2026-09-28", by: "Sophie", outcome: "bought" },
      "2026-09-28",
      {
        no: "9",
        vrfNo: "5881",
        veh: "SV-09",
        draftLines: [
          {
            cat: "Fuel — Diesel",
            item: "Fuel reserve dispense",
            supplier: "FUEL RESERVE",
            work: "FUEL-RES",
            qty: 1,
            price: 1690,
          },
        ],
      }
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].vrf, "5864");
    assert.equal(lines[0].veh, "MC-14");
    assert.equal(lines[0].supplier, "Iced Petron");
    assert.equal(lines[0].item, "Fuel");
    assert.notEqual(lines[0].supplier, "FUEL RESERVE");
    assert.equal(lines[0].total, 150.11);
  });

  it("treats two reserves on one number as a collision and does not remint a printed or posted owner", () => {
    const mcHold = { no: "14", vrfNo: "5864", status: "Requested", veh: "MC-14", vrfs: [] };
    const svHold = { no: "9", vrfNo: "5864", status: "Requested", veh: "SV-09", vrfs: [] };
    assert.equal(reservesClaimingVrf([mcHold, svHold], "5864").length, 2);
    assert.equal(shouldRemintHeldVrf(mcHold, [], [mcHold, svHold]), false);
    assert.equal(shouldRemintHeldVrf(svHold, [], [mcHold, svHold]), false);

    const printed = Object.assign({}, mcHold, { printedAt: "2026-09-25" });
    assert.equal(holdIsSealed(printed), true);
    assert.equal(
      shouldRemintHeldVrf(printed, [{ vrf: "5864", src: "ledger" }], [printed, svHold]),
      false
    );

    const postedOwner = {
      no: "14",
      vrfNo: "5864",
      status: "Approved",
      vrfs: ["5864"],
      veh: "MC-14",
    };
    const pending = { no: "9", vrfNo: "5864", status: "Requested", vrfs: [], veh: "SV-09" };
    assert.equal(shouldRemintHeldVrf(postedOwner, [{ vrf: "5864", src: "ledger" }], [postedOwner, pending]), false);
    assert.equal(shouldRemintHeldVrf(pending, [{ vrf: "5864", src: "ledger" }], [postedOwner, pending]), true);
  });
});

describe("VRF header edit keeps amounts and records an audit note", () => {
  it("sets the unit back and leaves totals, lines, and approval status", () => {
    const before = {
      veh: "SV-09",
      project: "",
      date: "2026-09-25",
      odo: "204707",
      requestedBy: "Sophie Batas",
      purpose: "Fuel reserve dispense",
      work: "FUEL-RES",
    };
    const patch = {
      veh: "MC-14",
      name: "YAMAHA MIO 125 (ORANGE/WHITE)",
      project: "UP- She Shelter",
      date: "2026-09-25",
      odo: 28935,
      requestedBy: "Sophie Batas",
      purpose: "Request by: Engr. Larry to deposit C/O Clifford",
      work: "FUEL-STN",
    };
    const notes = headerAuditNotes(before, patch, "Sophie Batas", "2026-09-28");
    assert.ok(notes.some((n) => n.field === "vehicle" && n.from === "SV-09" && n.to === "MC-14" && n.by === "Sophie Batas"));
    assert.ok(notes.every((n) => n.at && n.by && n.field && "from" in n && "to" in n));

    const row = {
      vrf: "5864",
      veh: "SV-09",
      qty: 1,
      price: 150.11,
      total: 150.11,
      vstatus: "Closed",
      liq: { at: "2026-09-28", outcome: "bought" },
      supplier: "Iced Petron",
      cat: "Fuel — Gasoline",
    };
    const patched = applyVrfHeaderPatch([row], patch, notes);
    assert.equal(patched[0].veh, "MC-14");
    assert.equal(patched[0].name, "YAMAHA MIO 125 (ORANGE/WHITE)");
    assert.equal(patched[0].project, "UP- She Shelter");
    assert.equal(patched[0].work, "FUEL-STN");
    assert.equal(patched[0].qty, 1);
    assert.equal(patched[0].price, 150.11);
    assert.equal(patched[0].total, 150.11);
    assert.equal(patched[0].vstatus, "Closed");
    assert.deepEqual(patched[0].liq, row.liq);
    assert.equal(patched[0].supplier, "Iced Petron");
    assert.equal(patched[0].vrf, "5864");

    const month = mergeLedgerRows([patched[0], sv09()], "5864", patched, "replace");
    assert.deepEqual(
      month.find((r) => r.vrf === "5881"),
      sv09()
    );
  });

  it("does not change the under-1000 auto-approve rule", () => {
    assert.equal(VRF_AUTO_APPROVE_UNDER, 1000);
    const hold = { status: "Requested", approvedBy: "" };
    const auto = applyVrfAutoApproval(hold, 150, "2026-09-25");
    assert.equal(auto, true);
    assert.equal(hold.status, "Approved");
    assert.equal(hold.approvedBy, "CEO policy");
    const queued = { status: "Requested" };
    assert.equal(applyVrfAutoApproval(queued, 1690, "2026-09-25"), false);
    assert.equal(queued.status, "Requested");
  });
});

describe("artifact HTML — per-VRF writes and Edit", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("keys ledger writes by VRF number and blocks a liquidate that would switch numbers", () => {
    assert.match(html, /async function replaceLedgerVrf/);
    assert.match(html, /async function readDocLive/);
    assert.match(html, /function assertSingleVrfOwner/);
    assert.match(html, /function rowsConfinedToVrf/);
    assert.match(html, /vrf_mismatch/);
    assert.match(html, /vrf_collision/);
    assert.match(html, /Stopped\. That would have changed VRF /);
    assert.match(html, /await appendLedger\(seedMonths\[si\], byMk\[seedMonths\[si\]\]\)/);
    assert.match(html, /function matchDraftLine/);
    assert.doesNotMatch(html, /var draft=drafts\[i\]/);
    assert.match(html, /if\(vrfNumberSealed\(changes\[ci\]\.from\)\) continue/);
    assert.match(html, /Could not reserve a VRF number/);
    assert.match(html, /var BUILD = "2026-10-05 a"/);
  });

  it("offers Edit on the log and inside the open VRF, and prints the audit note", () => {
    assert.match(html, /function openVrfEdit/);
    assert.match(html, /function saveVrfHeader/);
    assert.match(html, /function vrfMayEdit/);
    assert.match(html, /function vrfAuditList/);
    assert.match(html, /el\("button","btn sm","Edit"\)/);
    assert.match(html, /el\("button","btn","Edit"\)/);
    assert.match(html, /Corrections/);
    assert.match(html, /A VRF number is on more than one reserve/);
  });
});
