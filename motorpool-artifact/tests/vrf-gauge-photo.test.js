"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const audit = require("../public/fuel-audit.js");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const approveSrc = fs.readFileSync(path.join(__dirname, "../netlify/functions/approve-vrf.js"), "utf8");

function sliceFn(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start + startMark.length);
  assert.ok(start > 0 && end > start, startMark);
  return source.slice(start, end);
}

const vrf6298 = {
  kind: "photo",
  caption: "LRF-0013 photo 1.jpg",
  by: "Michelle Y.",
};

describe("gauge photo is read from the attachment, not only fuelPhotos.gauge", () => {
  it("is build 2026-11-12 a and does not change approve-vrf", () => {
    assert.match(html, /var BUILD = "2026-11-12 a"/);
    assert.doesNotMatch(approveSrc, /encoderChecklist|fuelPhotos|odoOverride/);
  });

  it("counts an unlabeled fuel still as the gauge photo", () => {
    const live = audit.fuelPhotoStatus([vrf6298, { kind: "photo", caption: "Screenshot 2026-11-05 083431.png" }]);
    assert.equal(live.gauge, true);
    assert.equal(live.noGauge, false);
    assert.equal(live.missing, false);
    assert.equal(audit.gaugePhotoLine({ fuel: true, photos: [vrf6298] }), "Gauge photo attached");
    assert.equal(audit.firstGaugePhoto([vrf6298]).caption, vrf6298.caption);
  });

  it("does not let a false fuelPhotos flag hide a picture that is already attached", () => {
    assert.equal(audit.gaugePhotoLine({
      fuel: true,
      fuelPhotos: { gauge: false, meter: false, receipt: false },
      photoCount: 2,
    }), "Gauge photo attached");
    assert.equal(audit.missingPhotoBadge({
      fuel: true,
      fuelPhotos: { gauge: false, meter: false, receipt: false },
      photoCount: 2,
    }), "");
    assert.equal(audit.gaugePhotoLine({
      fuel: true,
      photos: [vrf6298],
      fuelPhotos: { gauge: false, meter: false, receipt: false },
    }), "Gauge photo attached");
  });

  it("still warns when nothing is attached, or every file is labeled as something else", () => {
    assert.equal(audit.gaugePhotoLine({ fuel: true, photos: [], photoCount: 0 }), "No gauge photo");
    assert.equal(audit.gaugePhotoLine({
      fuel: true,
      fuelPhotos: { gauge: false, meter: false, receipt: false },
      photoCount: 0,
    }), "No gauge photo");
    assert.equal(audit.gaugePhotoLine({
      fuel: true,
      photos: [{ kind: "photo", role: "receipt", caption: "OR 100" }],
    }), "No gauge photo");
    assert.equal(audit.gaugePhotoLine({
      fuel: true,
      photos: [{ kind: "photo", role: "other", caption: "yard" }],
    }), "No gauge photo");
    assert.equal(audit.gaugePhotoLine({
      fuel: true,
      photos: [{ kind: "link", caption: "drive file" }],
    }), "No gauge photo");
    assert.equal(audit.gaugePhotoLine({ fuel: true }), "Fuel photos: n/a");
    assert.equal(audit.missingPhotoBadge({ fuel: false, photoCount: 2 }), "");
  });

  it("turns a new upload into fuelPhotos without clearing a gauge bit", () => {
    const fromShot = audit.nextFuelPhotos(
      { gauge: false, meter: false, receipt: false },
      vrf6298
    );
    assert.deepEqual(fromShot, { gauge: true, meter: false, receipt: false });
    const kept = audit.nextFuelPhotos(fromShot, { kind: "photo", role: "receipt", caption: "OR" });
    assert.equal(kept.gauge, true);
    assert.equal(kept.receipt, true);
    const other = audit.nextFuelPhotos(
      { gauge: false, meter: false, receipt: false },
      { kind: "photo", role: "other", caption: "not the gauge" }
    );
    assert.equal(other.gauge, false);
    const tagged = audit.nextFuelPhotos(
      { gauge: false, meter: false, receipt: false },
      { kind: "photo", role: "fuel-gauge", caption: "dash.jpg" }
    );
    assert.equal(tagged.gauge, true);
  });

  it("prints liters for a fuel line, including one whose unit was left off the row", () => {
    assert.equal(audit.lineUnitText({ cat: "Fuel — Diesel", unit: "liters", qty: 40 }), "liters");
    assert.equal(audit.lineUnitText({ cat: "Fuel — Gasoline", unit: "", qty: 20 }), "liters");
    assert.equal(audit.lineUnitText({ cat: "Fuel — Diesel", qty: 40 }), "liters");
    assert.equal(audit.lineUnitText({ cat: "Belt", unit: "pc" }), "pc");
    assert.equal(audit.lineUnitText({ cat: "Belt", unit: "" }), "");
    const print = sliceFn(html, "function buildVrfDoc(entry,photos,opts)", "function vrfDocFile");
    assert.match(print, /printLineUnit\(x\)/);
    assert.match(print, /el\("td","u",printLineUnit\(x\)\)/);
    assert.match(print, /Gauge photo attached/);
    assert.match(print, /data-gauge-photo/);
    const held = sliceFn(html, "function addHeldReserveVrfs()", "function vrfIndex()");
    assert.match(held, /unit:\(function\(\)\{ var u=String\(l\.unit==null\?"":l\.unit\)\.trim\(\)/);
    assert.match(held, /return isFuel\(l\.cat\)\?"liters":""/);
  });

  it("stores a chosen role on the photo and offers the gauge tag on a fuel VRF", () => {
    const add = sliceFn(html, "function photoRoleFields(rec)", "async function addPhotoToOwners");
    assert.match(add, /body\.role=roles\.role/);
    assert.match(add, /body\.fuelRole=roles\.fuelRole/);
    const form = sliceFn(html, "function vrfView()", "async function sendForApproval");
    assert.match(form, /\["other","Other"\]/);
    assert.match(form, /\["","Unlabeled"\]/);
    const send = sliceFn(html, "async function sendForApproval(d,btn,opts)", "async function postVrf");
    assert.match(send, /role:staged\[pi\]\.role\|\|""/);
    assert.match(html, /This is the gauge photo/);
    const open = sliceFn(html, "function openVrf(entry,tab)", "function blankLine()");
    assert.match(open, /rememberFuelPhotoFlags\(entry/);
    assert.match(open, /tagGaugePhoto\(entry, x\)/);
    assert.doesNotMatch(approveSrc, /fuelPhotos/);
  });
});
