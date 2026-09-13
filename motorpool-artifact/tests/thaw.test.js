"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { freezeRead, thaw, isFrozenDeep } = require("./lib/rules");
const { createStore } = require("./lib/store");

describe("frozen reads → thaw before mutate", () => {
  it("freezes nested objects and arrays", () => {
    const frozen = freezeRead({ a: { b: 1 }, lines: [{ qty: 2 }] });
    assert.equal(isFrozenDeep(frozen), true);
    assert.throws(() => {
      frozen.a.b = 9;
    }, TypeError);
    assert.throws(() => {
      frozen.lines.push({ qty: 3 });
    }, TypeError);
  });

  it("thaw returns a mutable deep copy", () => {
    const frozen = freezeRead({ a: { b: 1 }, lines: [{ qty: 2 }] });
    const live = thaw(frozen);
    live.a.b = 9;
    live.lines.push({ qty: 3 });
    assert.equal(live.a.b, 9);
    assert.equal(live.lines.length, 2);
    assert.equal(frozen.a.b, 1);
    assert.equal(frozen.lines.length, 1);
  });

  it("store.get is frozen; getThawed can be mutated and written back", () => {
    const store = createStore({
      "master/units": { units: [{ id: "SV-01", name: "Service" }] },
    });
    const read = store.get("master/units");
    assert.equal(Object.isFrozen(read), true);
    assert.throws(() => {
      read.units[0].name = "nope";
    }, TypeError);
    const next = store.getThawed("master/units");
    next.units[0].name = "Service pickup";
    store.set("master/units", next);
    assert.equal(store.get("master/units").units[0].name, "Service pickup");
  });

  it("config/app rejects a non-object and stores a full document", () => {
    const store = createStore();
    assert.throws(() => store.set("config/app", "nope"), /full-field write/);
    store.set("config/app", { company: "X", meterReadingHardStop: false });
    const cfg = store.get("config/app");
    assert.equal(cfg.company, "X");
    assert.equal(Object.isFrozen(cfg), true);
  });
});
