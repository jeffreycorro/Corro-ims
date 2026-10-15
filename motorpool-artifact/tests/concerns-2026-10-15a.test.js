"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  let start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

function loadFuel() {
  const names = ["fuelRules", "fuelLitresOf", "fuelCheck", "fuelUsageNote", "plainSendError"];
  const ctx = {
    S: { cfg: { fuel: null } },
    FUEL_DEFAULTS: { overTol: 0.6, bandTol: 0.4, minMove: { km: 5, hr: 0.5 }, enabled: true },
    _cons: [],
    _last: null,
    consumption() {
      return ctx._cons;
    },
    lastFuel() {
      return ctx._last;
    },
    meterOf() {
      return "km";
    },
    meterUnit() {
      return "km/L";
    },
    nnum(n, d) {
      if (n == null || Number.isNaN(Number(n))) return "—";
      const x = Number(n);
      return d == null ? String(Math.round(x)) : x.toFixed(d);
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

describe("2026-10-15a MC-02 fuel VRF is not blocked by usage", () => {
  it("is build 2026-10-15 a", () => {
    assert.match(html, /var BUILD = "2026-10-15 a"/);
  });

  it("does not read a 1 pc station line as one litre of usage", () => {
    const ctx = loadFuel();
    assert.equal(ctx.fuelLitresOf({ qty: 1, unit: "pc", liters: "", price: 200 }), 0);
    assert.equal(ctx.fuelLitresOf({ qty: "1", unit: "pc" }), 0);
    assert.equal(ctx.fuelLitresOf({ qty: 1, unit: "pc", liters: 2.4 }), 2.4);
    assert.equal(ctx.fuelLitresOf({ qty: 3, unit: "L" }), 3);
  });

  it("lets MC-02 send a normal fuel VRF when it has no earlier odometer", () => {
    const ctx = loadFuel();
    ctx._last = { date: "2026-03-23", odo: null, L: 1.21, vrf: "5022" };
    ctx._cons = [];
    const note = ctx.fuelUsageNote("MC-02", 10517, 0);
    assert.equal(note.blocksSend, false);
    assert.equal(note.check.stops.length, 0);
    assert.match(note.title + " " + note.detail, /MC-02/);
    assert.match(note.detail, /no earlier fuel fill with an odometer/);
    assert.match(note.detail, /no usage figure to go over/);
    assert.match(note.detail, /can be sent/);
  });

  it("names the limit when litres are over the unit average, and still does not block send", () => {
    const ctx = loadFuel();
    ctx._last = { date: "2026-03-23", odo: 10000, L: 1.2, vrf: "5022" };
    ctx._cons = [{ code: "MC-02", n: 3, avg: 40, best: 45, worst: 35, reliable: true }];
    const over = ctx.fuelUsageNote("MC-02", 10517, 40);
    assert.equal(over.blocksSend, false);
    assert.ok(over.check.stops.some((s) => s.code === "OVER_EXPECTED"));
    assert.match(over.detail, /MC-02/);
    assert.match(over.detail, /60%/);
    assert.match(over.detail, /does not block Send for approval/);
    const normal = ctx.fuelUsageNote("MC-02", 10050, 1.5);
    assert.equal(normal.blocksSend, false);
    assert.equal(normal.check.stops.length, 0);
  });

  it("send for approval does not stop on a fuel usage note, and explains a bare usage-exceeded error", () => {
    const send = extractFunction(html, "sendForApproval");
    const gate = extractFunction(html, "refreshGate");
    assert.match(send, /fuelLitresOf\(l\)/);
    assert.doesNotMatch(send, /parseFloat\(l\.qty\)/);
    assert.doesNotMatch(send, /usage exceeded/i);
    assert.doesNotMatch(send, /blocksSend/);
    assert.match(gate, /fuelUsageNote/);
    assert.doesNotMatch(gate, /\.disabled\s*=\s*true/);
    const ctx = loadFuel();
    const explained = ctx.plainSendError("usage exceeded");
    assert.match(explained, /not a block/);
    assert.match(explained, /allowance/);
    assert.equal(ctx.plainSendError("Pick a unit first."), "Pick a unit first.");
  });
});
