"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const audit = require("../public/fuel-audit.js");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function sliceFn(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start + startMark.length);
  assert.ok(start > 0 && end > start, startMark);
  return source.slice(start, end);
}

describe("fuel gauge photo does not block Send for approval", () => {
  it("is build 2026-10-29 d", () => {
    assert.match(html, /var BUILD = "2026-10-29 d"/);
  });

  it("reports No gauge photo and does not mark the photo set as a hard miss", () => {
    const none = audit.fuelPhotoStatus([]);
    assert.equal(none.label, "No gauge photo");
    assert.equal(none.missing, false);
    assert.equal(none.noGauge, true);
    const gauge = audit.fuelPhotoStatus([{ role: "fuel-gauge", caption: "tank" }]);
    assert.equal(gauge.label, "");
    assert.equal(gauge.missing, false);
    assert.equal(audit.missingPhotoBadge({
      fuel: true,
      photos: [{ role: "odometer", caption: "dash" }]
    }), "No gauge photo");
    assert.equal(audit.missingPhotoBadge({
      fuel: true,
      photos: [{ caption: "Fuel gauge" }]
    }), "");
  });

  it("keeps the warning off the send block and on the VRF, approval, and audit screens", () => {
    const review = sliceFn(html, "function fuelRequestReview(spec)", "function numOrNull");
    assert.match(review, /No gauge photo/);
    assert.doesNotMatch(review, /out\.blocks\.push/);
    assert.doesNotMatch(review, /needsNote\./);
    assert.match(review, /Fuel Reserve and hour-meter units/);
    assert.doesNotMatch(review, /missing photos/);

    const send = sliceFn(html, "async function sendForApproval(d,btn,opts)", "async function postVrf");
    assert.match(send, /Fuel checks never refuse this send/);
    assert.doesNotMatch(send, /if\(review\.blocks/);
    assert.doesNotMatch(send, /Add a fuel-gauge photo|odometer or hour-meter photo|missing photos/);

    const approval = sliceFn(html, "function approveView()", "function remindView()");
    assert.match(approval, /missingPhotosChip\(\{vrf:r\.vrfNo/);
    assert.match(approval, /No gauge photo|missingPhotosChip/);

    const auditView = sliceFn(html, "function fuelAuditView()", "function addIsoDays");
    assert.match(auditView, /el\("span","chip warn","No gauge photo"\)/);
    assert.match(auditView, /a warning, not a block on Send for approval/);

    const open = sliceFn(html, "function openVrf(entry,tab)", "function blankLine()");
    assert.match(open, /missingPhotosChip\(entry\)/);
    const reserve = sliceFn(html, "function openReserve(no,asApprover)", "function approveView()");
    assert.match(reserve, /missingPhotosChip\(/);

    assert.match(html, /auditChip\("No gauge photo", "warn"\)/);
    assert.match(html, /photoLine\.textContent="No gauge photo"/);
    assert.doesNotMatch(html, /Add a fuel-gauge photo and an odometer or hour-meter photo/);

    const paint = sliceFn(html, "function paintFuelAuditNote(host, d)", "function fuelChecklistNeeds");
    assert.match(paint, /banner warn/);
    assert.doesNotMatch(paint, /banner crit/);
    const checklist = sliceFn(html, "function askEncoderChecklist", "async function voidRequestedReserve");
    assert.doesNotMatch(checklist, /if\(!ready\.ok\)/);
    assert.match(checklist, /do not stop Send for approval/);
  });

  it("treats an Other-tagged photo as a warning, not a gauge photo", () => {
    const other = audit.fuelPhotoStatus([
      { role: "", caption: "tank before fill" },
      { role: "Other", caption: "photo" }
    ]);
    assert.equal(other.gauge, false);
    assert.equal(other.meter, false);
    assert.equal(other.missing, false);
    assert.equal(other.label, "No gauge photo");
    const hour = audit.fuelPhotoStatus([{ role: "hour-meter", caption: "BH-05 meter" }]);
    assert.equal(hour.meter, true);
    assert.equal(hour.label, "No gauge photo");
    assert.equal(hour.missing, false);
  });
});
