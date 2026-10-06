"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const {
  vrfSpendTotal,
  vrfTotalAutoApproves,
  applyVrfAutoApproval,
  VRF_AUTO_APPROVE_UNDER,
} = require("./lib/rules");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function freshHold() {
  return {
    status: "Requested",
    budget: 0,
    approvedBudget: null,
    approvedBy: "",
    approvedAt: "",
    decisionNote: "",
    vrfs: [],
  };
}

describe("VRF auto-approve under ₱1,000", () => {
  it("uses the same line total as Send for approval (qty × price)", () => {
    assert.equal(VRF_AUTO_APPROVE_UNDER, 1000);
    const total = vrfSpendTotal([
      { cat: "Bolt", qty: "2", price: "150.50" },
      { cat: "Washer", qty: 1, price: 49.5 },
      { cat: "", qty: 9, price: 9999 },
    ]);
    assert.equal(total, 2 * 150.5 + 49.5);
    assert.equal(vrfTotalAutoApproves(total), true);
  });

  it("approves strictly under 1000 and leaves 1000 and above waiting", () => {
    assert.equal(vrfTotalAutoApproves(0), false);
    assert.equal(vrfTotalAutoApproves(0.01), true);
    assert.equal(vrfTotalAutoApproves(999.99), true);
    assert.equal(vrfTotalAutoApproves("₱ 999.99"), true);
    assert.equal(vrfTotalAutoApproves(1000), false);
    assert.equal(vrfTotalAutoApproves("1,000"), false);
    assert.equal(vrfTotalAutoApproves(1000.01), false);
    assert.equal(vrfTotalAutoApproves("₱ 2,450.00"), false);
  });

  it("stamps Approved the way an office approval does, without the remote API marker", () => {
    const small = freshHold();
    small.budget = 450;
    assert.equal(applyVrfAutoApproval(small, 450, "2026-09-28"), true);
    assert.equal(small.status, "Approved");
    assert.equal(small.approvedBudget, 450);
    assert.equal(small.approvedBy, "CEO policy");
    assert.equal(small.approvedAt, "2026-09-28");
    assert.match(small.decisionNote, /under ₱1,000/);
    assert.equal(small.approvedVia, undefined);
    assert.deepEqual(small.vrfs, []);

    const exact = freshHold();
    exact.budget = 1000;
    assert.equal(applyVrfAutoApproval(exact, 1000, "2026-09-28"), false);
    assert.equal(exact.status, "Requested");
    assert.equal(exact.approvedBudget, null);
    assert.equal(exact.approvedBy, "");
  });
});

describe("artifact HTML — auto-approve on send, queue unchanged at ₱1,000+", () => {
  it("keeps the artifact script syntactically valid", () => {
    const match = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(match && match[1], "inline artifact script");
    const tmp = path.join(os.tmpdir(), "motorpool-auto-approve-check.js");
    fs.writeFileSync(tmp, match[1]);
    const checked = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr || "node --check failed");
  });

  it("posts a sub-1000 VRF on create and still queues a larger one", () => {
    const start = html.indexOf("async function sendForApproval");
    const end = html.indexOf("\nasync function postVrf", start);
    assert.ok(start > 0 && end > start);
    const body = html.slice(start, end);
    assert.match(body, /var total=vrfSpendTotal\(d\.lines\)/);
    assert.match(body, /status:"Requested"/);
    assert.match(body, /var auto=applyVrfAutoApproval\(hold, total, iso\(\)\)/);
    assert.match(body, /if\(auto\)\{[\s\S]*await postAndSaveReserve\(hold\)/);
    assert.match(body, /sent for approval at /);
    assert.match(body, /Requested \/ FOR APPROVAL/);
    assert.match(body, /skipped the approval queue/);
    assert.doesNotMatch(body, /approvedVia/);
    assert.doesNotMatch(body, /approve-vrf/);
    assert.doesNotMatch(body, /appendLedger/);
    assert.match(html, /function applyVrfAutoApproval/);
    assert.match(html, /var VRF_AUTO_APPROVE_UNDER=1000/);
    assert.match(html, /return n>0 && n<VRF_AUTO_APPROVE_UNDER/);
    assert.match(html, /var BUILD = "2026-10-06 a"/);
  });
});
