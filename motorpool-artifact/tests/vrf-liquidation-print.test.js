"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const os = require("os");
const {
  VARIANCE_PRINT_MAX,
  VARIANCE_TOL_DEFAULT,
  VRF_ORIGINAL_MARK,
  VRF_LIQUIDATED_MARK,
  VRF_VARIANCE_PREVIEW_MARK,
  VRF_PROOF_PREVIEW_MARK,
  VRF_PREVIEW_MARK,
  variancePrintBlocked,
  variancePrintMessage,
  formatVariancePct,
  originalApprovedSource,
  liquidatedVariance,
  fuelLiterNotice,
  changeOwedAmount,
  liquidationProofGate,
  liquidatedPrintBlock,
  editionStamp,
  vrfWasNeverApproved,
  applyVarianceApproval,
  liquidationVarianceReport,
  vrfIsLiquidated,
} = require("../netlify/lib/liquidation-variance");
const { applyReserveReopen, varianceNotice, varianceFlag } = require("./lib/rules");
const { createHandler, vrfsFromLedger } = require("../netlify/functions/liquidation-variance-report");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function seal(vrf, rows, at, reserveNo) {
  return {
    numbers: {
      [vrf + "@" + reserveNo]: {
        no: vrf,
        at: at,
        sealed: true,
        reason: "approved",
        snapshot: { rows: rows, reserve: { no: reserveNo, vrfNo: vrf, approvedBudget: 99999 } },
      },
    },
  };
}

describe("liquidated print variance", () => {
  it("keeps the 10% flag informational", () => {
    assert.equal(VARIANCE_TOL_DEFAULT, 0.1);
    assert.equal(varianceFlag(1000, 1100), false);
    assert.equal(varianceFlag(1000, 1100.01), true);
    const notice = varianceNotice(1000, 1600);
    assert.equal(notice.block, false);
    assert.equal(notice.notice, true);
    assert.equal(variancePrintBlocked(1000, 1600), true);
  });

  it("prints at 50% and blocks at 50.01%", () => {
    assert.equal(VARIANCE_PRINT_MAX, 0.5);
    assert.equal(variancePrintBlocked(1000, 1500), false);
    assert.equal(variancePrintBlocked(1000, 1500.1), true);
    assert.match(variancePrintMessage(0.6301), /Variance \+63\.01% needs Jeffrey's approval before the liquidated VRF can print/);
    assert.equal(formatVariancePct(0.63), "+63%");
  });

  it("uses the sealed snapshot qty and price, and labels an approvedBudget fallback", () => {
    const issued = seal("7001", [{ cat: "Bolt", qty: 2, price: 500, total: 1 }], "2026-10-01", "9");
    const src = originalApprovedSource("7001", issued, { no: "9", approvedBudget: 50, draftLines: [] });
    assert.equal(src.source, "snapshot");
    assert.equal(src.amount, 1000);
    assert.equal(src.label, "");
    const live = [{ cat: "Bolt", qty: 2, price: 800, total: 1600 }];
    const over = liquidatedVariance(live, src, { varianceApprovedBy: "", varianceApprovedAt: "" });
    assert.equal(over.approved, 1000);
    assert.equal(over.actual, 1600);
    assert.equal(over.printBlocked, true);
    const fallback = originalApprovedSource("7002", { numbers: {} }, {
      no: "10",
      approvedBudget: 400,
      draftLines: [{ cat: "Bolt", qty: 1, price: 10 }],
    });
    assert.equal(fallback.source, "approvedBudget");
    assert.equal(fallback.amount, 400);
    assert.match(fallback.label, /no sealed snapshot/);
    const under = liquidatedVariance([{ cat: "Bolt", qty: 1, price: 250, total: 250 }], fallback, null);
    assert.equal(under.changeOwed, 150);
    assert.equal(changeOwedAmount(400, 250), 150);
  });

  it("approval unblocks and reopen clears it", () => {
    const reserve = {
      no: "9",
      vrfNo: "7001",
      status: "Flagged",
      liquidatedAt: "2026-10-02",
      actual: 1600,
      approvedBudget: 1000,
      vrfs: ["7001"],
      audit: [],
      varianceApprovedBy: "",
      varianceApprovedAt: "",
    };
    const src = originalApprovedSource("7001", seal("7001", [{ qty: 1, price: 1000, cat: "Bolt" }], "2026-10-01", "9"), reserve);
    assert.equal(liquidatedVariance([{ qty: 2, price: 800, cat: "Bolt" }], src, reserve).printBlocked, true);
    assert.equal(applyVarianceApproval(reserve, "Jeffrey James M. Corro", "2026-10-03T09:00:00", "scope grew", "+60%"), true);
    assert.equal(reserve.varianceApprovedBy, "Jeffrey James M. Corro");
    assert.equal(reserve.audit[0].field, "variance-approval");
    assert.equal(liquidatedVariance([{ qty: 2, price: 800, cat: "Bolt" }], src, reserve).printBlocked, false);
    assert.equal(applyReserveReopen(reserve, "Brinneshiel", "2026-10-04", 1600, { at: "2026-10-02", by: "yard" }, "price was wrong"), true);
    assert.equal(reserve.varianceApprovedBy, "");
    assert.equal(reserve.varianceApprovedAt, "");
    assert.equal(reserve.varianceApprovedNote, "");
    const reopen = reserve.audit.find((n) => n.field === "reopen");
    assert.equal(reopen.by, "Brinneshiel");
    assert.match(reopen.note, /Reason: price was wrong/);
    assert.match(reopen.reason, /price was wrong/);
  });

  it("flags fuel litres without blocking, including equal pesos", () => {
    const over = fuelLiterNotice(40, 46, 1000, 1200);
    assert.equal(over.flag, true);
    assert.equal(over.block, false);
    assert.match(over.note, /notice only/);
    const samePesos = fuelLiterNotice(40, 38, 1000, 1000);
    assert.equal(samePesos.flag, true);
    assert.equal(samePesos.block, false);
    assert.match(samePesos.note, /litres differ/);
    const quiet = fuelLiterNotice(40, 40, 1000, 1100);
    assert.equal(quiet.flag, false);
  });

  it("stamps original from the snapshot and blocks liquidated print without proof", () => {
    const closed = { vrf: "7001", status: "Closed" };
    assert.equal(editionStamp(closed, "original", null), VRF_ORIGINAL_MARK);
    assert.equal(editionStamp(closed, "liquidated", { print: false }), VRF_LIQUIDATED_MARK);
    const varianceBlock = liquidatedPrintBlock(
      { printBlocked: true, message: variancePrintMessage(0.63), pct: 0.63 },
      { block: false }
    );
    assert.equal(varianceBlock.previewMark, VRF_VARIANCE_PREVIEW_MARK);
    assert.match(varianceBlock.messages[0], /needs Jeffrey's approval/);
    const proof = liquidationProofGate({ photoCount: 0, fuelReserve: false, gauge: false });
    assert.equal(proof.block, true);
    assert.match(proof.message, /at least one photo/);
    const gauge = liquidationProofGate({ photoCount: 2, fuelReserve: true, gauge: false });
    assert.match(gauge.message, /fuel-gauge photo/);
    assert.equal(liquidationProofGate({ photoCount: 1, fuelReserve: false, gauge: false }).ok, true);
    assert.equal(liquidationProofGate({ photoCount: 1, fuelReserve: true, gauge: true }).ok, true);
    const both = liquidatedPrintBlock(
      { printBlocked: true, message: "Variance +63% needs Jeffrey's approval before the liquidated VRF can print", pct: 0.63 },
      proof
    );
    assert.equal(editionStamp(closed, "liquidated", both), VRF_VARIANCE_PREVIEW_MARK);
    assert.equal(editionStamp({ vrf: "1", status: "Requested" }, "original", null), VRF_PREVIEW_MARK);
    assert.equal(vrfWasNeverApproved({ vrf: "1", status: "Requested" }), true);
    assert.equal(vrfWasNeverApproved(closed), false);
  });

  it("lists liquidated VRFs over 50% and leaves the rest out", () => {
    const report = liquidationVarianceReport({
      issued: seal("7001", [{ qty: 1, price: 1000, cat: "Bolt" }], "2026-10-01", "9"),
      reserves: [
        { no: "9", vrfNo: "7001", approvedBudget: 10 },
        { no: "11", vrfNo: "7002", approvedBudget: 1000 },
      ],
      vrfs: [
        { vrf: "7001", status: "Closed", reserve: "9", rows: [{ qty: 1, price: 1600, cat: "Bolt" }] },
        { vrf: "7002", status: "Closed", reserve: "11", rows: [{ qty: 1, price: 1000, cat: "Bolt" }] },
        { vrf: "7003", status: "Open", rows: [{ qty: 1, price: 9000, cat: "Bolt" }] },
      ],
    });
    assert.equal(report.count, 1);
    assert.equal(report.rows[0].vrf, "7001");
    assert.equal(report.rows[0].printBlocked, true);
    assert.equal(report.rows[0].source, "snapshot");
    assert.equal(vrfIsLiquidated({ status: "Open" }), false);
  });
});

describe("liquidation variance report endpoint", () => {
  it("is read-only and lists the over-50 rows", async () => {
    const handler = createHandler({
      secret: "report-secret",
      load: async function () {
        return {
          issued: seal("8001", [{ qty: 1, price: 100, cat: "Fuel — Diesel", liters: 10, unit: "L" }], "2026-10-01", "3"),
          reserves: [{ no: "3" }],
          vrfs: vrfsFromLedger({
            "2026-10": [
              { vrf: "8001", vstatus: "Closed", reserve: "3", cat: "Fuel — Diesel", qty: 1, price: 200, liters: 12, unit: "L" },
              { vrf: "8002", vstatus: "Open", cat: "Bolt", qty: 1, price: 50 },
            ],
          }),
        };
      },
    });
    const denied = await handler({ httpMethod: "GET", headers: {} });
    assert.equal(denied.statusCode, 401);
    const res = await handler({ httpMethod: "GET", headers: { authorization: "Bearer report-secret" } });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.readOnly, true);
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].vrf, "8001");
    const posted = await handler({ httpMethod: "POST", headers: { authorization: "Bearer report-secret" } });
    assert.equal(posted.statusCode, 405);
  });
});

describe("artifact HTML — liquidated print versions", () => {
  it("is build 2026-11-05 b and keeps the script valid", () => {
    assert.match(html, /var BUILD = "2026-11-05 b"/);
    assert.match(html, /var VARIANCE_PRINT_MAX=0\.50/);
    const match = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/);
    const tmp = path.join(os.tmpdir(), "motorpool-liq-print-check.js");
    fs.writeFileSync(tmp, match[1]);
    const checked = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr || "node --check failed");
  });

  it("offers Original and Liquidated next to Print and Preview", () => {
    assert.match(html, /data-vrf-print-edition/);
    assert.match(html, /Original \(approved\)/);
    assert.match(html, /"Liquidated"/);
    assert.match(html, /APPROVED \\u2013 ORIGINAL/);
    assert.match(html, /VARIANCE NOT APPROVED \\u2013 PREVIEW ONLY/);
    assert.match(html, /LIQUIDATION NOT PROVED \\u2013 PREVIEW ONLY/);
    assert.match(html, /Change owed \/ returned/);
    assert.match(html, /Say why this liquidation is being reopened/);
    assert.match(html, /function clearVarianceApproval/);
    assert.match(html, /resolveApprover\(aw\.value\)/);
    assert.match(html, /approvedBy=approver\.name/);
    const open = html.slice(html.indexOf("function openVrf(entry,tab)"), html.indexOf("function blankLine()"));
    assert.ok(open.indexOf("Original (approved)") < open.indexOf('el("button","btn","Print / save as PDF")'));
    assert.match(open, /printVrf\(entry\)/);
    assert.match(open, /previewVrfPrint\(entry\)/);
  });
});
