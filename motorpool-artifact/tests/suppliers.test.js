"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function loadSupplierApi() {
  const m = html.match(
    /\/\* --- supplier-master:start --- \*\/([\s\S]*?)\/\* --- supplier-master:end --- \*\//
  );
  assert.ok(m, "supplier master helpers are marked in index.html");
  const ctx = {};
  vm.runInNewContext(
    `${m[1]}\nresult = {normSupplierName, supplierMatchKey, reservedSupplierName, supplierNameOf, mergeSupplierRows, sameSupplierList, planSupplierAdd, planSupplierRename, planSupplierRemove, applySupplierChange, supplierDocBody, foldSupplierBase};`,
    ctx
  );
  return ctx.result;
}

const api = loadSupplierApi();
const meta = { addedBy: "Ana Cruz", addedAt: "2026-09-26T01:02:03.000Z" };
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

describe("supplier names", () => {
  it("trims and collapses spaces and rejects a blank name", () => {
    assert.equal(api.normSupplierName("  Petron   Labangon  "), "Petron Labangon");
    assert.equal(api.normSupplierName("   "), "");
    const blank = api.planSupplierAdd([], "   ", meta);
    assert.equal(blank.ok, false);
    assert.equal(blank.reason, "blank");
    assert.deepEqual(plain(blank.suppliers), []);
    const punct = api.planSupplierAdd([{ name: "Shell" }], " — ", meta);
    assert.equal(punct.ok, false);
    assert.equal(punct.reason, "blank");
    assert.equal(punct.suppliers.length, 1);
  });

  it("matches case, punctuation and extra spaces, including the reserved names", () => {
    assert.equal(api.supplierMatchKey("Petron, Inc."), api.supplierMatchKey("  petron   inc "));
    assert.equal(api.supplierMatchKey("Fuel-Reserve"), api.supplierMatchKey("FUEL RESERVE"));
    assert.equal(api.supplierMatchKey("Motorpool   Inventory!"), "motorpool inventory");
    assert.equal(api.reservedSupplierName("fuel reserve"), "FUEL RESERVE");
    assert.equal(api.reservedSupplierName("motorpool-inventory"), "MOTORPOOL INVENTORY");

    const dup = api.planSupplierAdd([{ name: "Petron, Inc.", id: "p1" }], "petron inc", meta);
    assert.equal(dup.ok, true);
    assert.equal(dup.existing, true);
    assert.equal(dup.name, "Petron, Inc.");
    assert.equal(dup.suppliers.length, 1);
    assert.equal(dup.suppliers[0].id, "p1");

    const reserved = api.planSupplierAdd([{ name: "Shell" }], " fuel-reserve ", meta);
    assert.equal(reserved.existing, true);
    assert.equal(reserved.reserved, true);
    assert.equal(reserved.name, "FUEL RESERVE");
    assert.deepEqual(plain(reserved.suppliers.map(api.supplierNameOf)), ["Shell"]);
  });

  it("appends a new row, keeps addedBy and addedAt, and sorts A to Z", () => {
    const added = api.planSupplierAdd(
      [{ name: "Shell" }, { name: "Caltex" }],
      "  Beta   Parts ",
      meta
    );
    assert.equal(added.ok, true);
    assert.equal(added.existing, false);
    assert.deepEqual(plain(added.suppliers.map(api.supplierNameOf)), ["Beta Parts", "Caltex", "Shell"]);
    const row = added.suppliers[0];
    assert.equal(row.name, "Beta Parts");
    assert.equal(row.addedBy, "Ana Cruz");
    assert.equal(row.addedAt, "2026-09-26T01:02:03.000Z");
  });
});

describe("supplier list writes", () => {
  it("merges a concurrent add instead of wiping it", () => {
    const remote = [{ name: "Shell" }, { name: "Caltex", addedBy: "Bea" }];
    const local = [{ name: "Shell" }, { name: "Petron", addedBy: "Ana", addedAt: meta.addedAt }];
    const planned = api.applySupplierChange(remote, local, {
      op: "add",
      name: "  new   station ",
      meta: meta,
    });
    assert.equal(planned.ok, true);
    assert.equal(planned.existing, false);
    assert.equal(planned.write, true);
    assert.deepEqual(plain(planned.suppliers.map(api.supplierNameOf)), [
      "Caltex",
      "new station",
      "Petron",
      "Shell",
    ]);
    assert.equal(planned.suppliers.find((r) => r.name === "Caltex").addedBy, "Bea");
    assert.equal(planned.suppliers.find((r) => r.name === "Petron").addedBy, "Ana");
  });

  it("keeps the document key the file already uses", () => {
    const list = [{ name: "Shell" }];
    const suppliersOnly = api.supplierDocBody({ suppliers: [{ name: "Old" }], note: "keep" }, list);
    assert.deepEqual(plain(Object.keys(suppliersOnly).sort()), ["note", "suppliers"]);
    assert.equal(suppliersOnly.note, "keep");
    assert.deepEqual(plain(suppliersOnly.suppliers), list);
    assert.equal(suppliersOnly.rows, undefined);

    const rowsOnly = api.supplierDocBody({ rows: [{ name: "Old" }], rev: 2 }, list);
    assert.deepEqual(plain(Object.keys(rowsOnly).sort()), ["rev", "rows"]);
    assert.deepEqual(plain(rowsOnly.rows), list);
    assert.equal(rowsOnly.suppliers, undefined);

    const both = api.supplierDocBody({ rows: [{ name: "A" }], suppliers: [{ name: "B" }] }, list);
    assert.deepEqual(plain(both.rows), list);
    assert.deepEqual(plain(both.suppliers), list);

    const fresh = api.supplierDocBody(null, list);
    assert.deepEqual(plain(fresh), { suppliers: list });
  });

  it("renames and removes on the master list only", () => {
    const ledger = [{ supplier: "Typo Shop", vrf: "5801", total: 100 }];
    const renamed = api.planSupplierRename(
      [{ name: "Typo Shop", addedBy: "Ana", addedAt: meta.addedAt }],
      "typo shop",
      "  Correct   Shop "
    );
    assert.equal(renamed.ok, true);
    assert.equal(renamed.suppliers[0].name, "Correct Shop");
    assert.equal(renamed.suppliers[0].addedBy, "Ana");
    assert.equal(ledger[0].supplier, "Typo Shop");

    const clash = api.planSupplierRename(
      [{ name: "Alpha" }, { name: "Beta" }],
      "Alpha",
      "beta"
    );
    assert.equal(clash.ok, false);
    assert.equal(clash.reason, "duplicate");
    assert.deepEqual(plain(clash.suppliers.map(api.supplierNameOf)), ["Alpha", "Beta"]);

    const reserved = api.planSupplierRename([{ name: "Shell" }], "Shell", "Fuel Reserve");
    assert.equal(reserved.ok, false);
    assert.equal(reserved.reason, "reserved");

    const removed = api.planSupplierRemove(
      [{ name: "Correct Shop" }, { name: "Shell" }],
      "correct-shop"
    );
    assert.equal(removed.ok, true);
    assert.deepEqual(plain(removed.suppliers.map(api.supplierNameOf)), ["Shell"]);
    assert.equal(ledger[0].supplier, "Typo Shop");

    const keepBuiltin = api.planSupplierRemove(
      [{ name: "Shell" }, { name: "MOTORPOOL INVENTORY" }],
      "motorpool inventory"
    );
    assert.equal(keepBuiltin.ok, false);
    assert.equal(keepBuiltin.reason, "reserved");
    assert.equal(keepBuiltin.suppliers.length, 2);
  });

  it("does not put a removed name back when someone else added a different one", () => {
    const planned = api.applySupplierChange(
      [{ name: "Keep" }, { name: "Drop" }, { name: "Other" }],
      [{ name: "Keep" }, { name: "Drop" }, { name: "Local Only", addedBy: "Ana" }],
      { op: "remove", name: "Drop" }
    );
    assert.equal(planned.write, true);
    assert.deepEqual(plain(planned.suppliers.map(api.supplierNameOf)), ["Keep", "Local Only", "Other"]);
  });
});

describe("saving suppliers", () => {
  function loadCommit() {
    const commitSrc = html.slice(
      html.indexOf("async function commitSupplierChange"),
      html.indexOf("function supplierSaveToast")
    );
    return commitSrc;
  }

  it("re-reads just before the write and keeps a name someone else added", async () => {
    let writes = 0;
    let server = { suppliers: [{ name: "Shell" }] };
    const ctx = {
      S: { suppliers: [{ name: "Shell" }], db: {} },
      PATHS: { suppliers: "master/suppliers" },
      masterList(doc, key) {
        if (!doc) return [];
        if (Array.isArray(doc.rows)) return doc.rows;
        if (key && Array.isArray(doc[key])) return doc[key];
        if (Array.isArray(doc.suppliers)) return doc.suppliers;
        return [];
      },
      async readDoc() {
        return JSON.parse(JSON.stringify(server));
      },
      async writeDoc(path, body, opts) {
        writes += 1;
        assert.equal(path, "master/suppliers");
        assert.equal(opts.quiet, true);
        if (writes === 1) {
          server = { suppliers: [{ name: "Caltex", addedBy: "Bea" }, { name: "Shell" }] };
          return { ok: true, shared: true };
        }
        server = JSON.parse(JSON.stringify(body));
        return { ok: true, shared: true };
      },
    };
    Object.assign(ctx, api);
    vm.runInNewContext(`${loadCommit()}\nthis.commitSupplierChange = commitSupplierChange;`, ctx);
    const res = await ctx.commitSupplierChange({ op: "add", name: "  Petron ", meta: meta });
    assert.equal(res.localOnly, false);
    assert.equal(res.shared, true);
    assert.equal(writes, 2);
    assert.deepEqual(
      server.suppliers.map((row) => row.name),
      ["Caltex", "Petron", "Shell"]
    );
    assert.equal(server.suppliers[0].addedBy, "Bea");
    assert.equal(server.suppliers[1].addedBy, "Ana Cruz");
    assert.equal(server.rows, undefined);
  });

  it("says the save stayed on this device when the shared write fails", async () => {
    const stored = [];
    const ctx = {
      S: { suppliers: [{ name: "Shell" }], db: {} },
      PATHS: { suppliers: "master/suppliers" },
      masterList(doc, key) {
        if (!doc) return [];
        if (Array.isArray(doc.rows)) return doc.rows;
        if (Array.isArray(doc.suppliers)) return doc.suppliers;
        return [];
      },
      async readDoc() {
        return { suppliers: [{ name: "Shell" }] };
      },
      async writeDoc(path, body, opts) {
        stored.push({ path, body, opts });
        return { ok: false, local: true };
      },
    };
    Object.assign(ctx, api);
    vm.runInNewContext(`${loadCommit()}\nthis.commitSupplierChange = commitSupplierChange;`, ctx);
    const res = await ctx.commitSupplierChange({ op: "add", name: "Harbor Gas", meta: meta });
    assert.equal(res.ok, true);
    assert.equal(res.localOnly, true);
    assert.equal(res.shared, false);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].opts.quiet, true);
    assert.deepEqual(
      plain(ctx.S.suppliers.map(api.supplierNameOf)),
      ["Harbor Gas", "Shell"]
    );
  });
});

describe("supplier dropdowns on the page", () => {
  it("is this build and offers add-supplier on every supplier picker", () => {
    assert.match(html, /var BUILD = "2026-09-26 a"/);
    assert.match(html, /bindSupplierSelect\(ss, "vrf"/);
    assert.match(html, /bindSupplierSelect\(sel, "liq"/);
    assert.match(html, /bindSupplierSelect\(bsup, "bulk"/);
    assert.match(html, /\+ Add new supplier…/);
    assert.match(html, /FUEL RESERVE — drum dispense \(not a purchase\)/);
    assert.match(html, /function openSuppliersManager/);
    assert.match(html, /Manage suppliers/);
    assert.match(html, /Old VRF lines keep the name they were saved with/);
    const commit = html.slice(
      html.indexOf("async function commitSupplierChange"),
      html.indexOf("function supplierSaveToast")
    );
    assert.ok(commit.indexOf("readDoc(PATHS.suppliers)") < commit.indexOf("writeDoc(PATHS.suppliers"));
    assert.match(commit, /quiet:\s*true/);
    assert.match(commit, /masterList\(doc, "suppliers"\)/);
    const fill = html.slice(
      html.indexOf("function fillSupplierSelect"),
      html.indexOf("function refreshSupplierSelects")
    );
    assert.ok(fill.indexOf('kind==="bulk"') > -1);
    const bulk = fill.slice(fill.indexOf('kind==="bulk"'), fill.indexOf("}else{"));
    assert.doesNotMatch(bulk, /FUEL RESERVE/);
    assert.doesNotMatch(bulk, /MOTORPOOL INVENTORY/);
    assert.match(html, /is saved on this device only/);
  });

  it("puts the new name on the line that asked and refreshes the other dropdowns", () => {
    const ui = html.slice(
      html.indexOf("var ADD_SUPPLIER_VALUE"),
      html.indexOf("async function commitSupplierChange")
    );
    const saveToast = html.slice(
      html.indexOf("function supplierSaveToast"),
      html.indexOf("function openAddSupplierPrompt")
    );
    const bind = html.slice(
      html.indexOf("function bindSupplierSelect"),
      html.indexOf("function openSuppliersManager")
    );
    const picks = [];
    function FakeOption(text, value) {
      this.text = text;
      this.value = value == null ? text : String(value);
    }
    const ctx = {
      Option: FakeOption,
      S: {
        suppliers: [
          { name: "MOTORPOOL INVENTORY", system: true },
          { name: "Shell" },
          { name: "Caltex" },
        ],
      },
      toasts: [],
      prompts: [],
      toast(msg) {
        ctx.toasts.push(msg);
      },
      openAddSupplierPrompt(cb) {
        ctx.prompts.push(cb);
      },
      document: {
        querySelectorAll(sel) {
          assert.equal(sel, "select[data-supplier-pick]");
          return picks;
        },
      },
    };
    vm.runInNewContext(`${ui}\n${saveToast}\n${bind}\nthis.api={fillSupplierSelect,bindSupplierSelect,ADD_SUPPLIER_VALUE};`, ctx);
    Object.assign(ctx, api);

    function makeSelect() {
      const options = [];
      const listeners = {};
      const sel = {
        options,
        value: "",
        setAttribute(name) {
          if (name === "data-supplier-pick") picks.push(sel);
        },
        appendChild(opt) {
          options.push(opt);
        },
        addEventListener(type, fn) {
          (listeners[type] || (listeners[type] = [])).push(fn);
        },
        dispatch() {
          (listeners.change || []).forEach((fn) => fn());
        },
      };
      Object.defineProperty(sel, "innerHTML", {
        set() {
          options.length = 0;
        },
        get() {
          return "";
        },
      });
      return sel;
    }

    const line = makeSelect();
    const other = makeSelect();
    let chosen = "";
    ctx.api.bindSupplierSelect(line, "vrf", "", (name) => {
      chosen = name;
    });
    ctx.api.bindSupplierSelect(other, "bulk", "Shell", null);

    const values = (sel) => sel.options.map((o) => o.value);
    assert.deepEqual(plain(values(line)), [
      "",
      "MOTORPOOL INVENTORY",
      "MOTORPOOL INVENTORY",
      "Shell",
      "Caltex",
      "FUEL RESERVE",
      "\u0000add-supplier",
    ]);
    assert.equal(line.options[line.options.length - 1].text, "+ Add new supplier…");
    assert.equal(line.options.find((o) => o.value === "FUEL RESERVE").text,
      "FUEL RESERVE — drum dispense (not a purchase)");
    assert.deepEqual(plain(values(other)), [
      "",
      "MOTORPOOL INVENTORY",
      "Shell",
      "Caltex",
      "\u0000add-supplier",
    ]);
    assert.equal(other.value, "Shell");

    line.value = ctx.api.ADD_SUPPLIER_VALUE;
    line.dispatch();
    assert.equal(line.value, "");
    assert.equal(ctx.prompts.length, 1);

    ctx.S.suppliers = ctx.S.suppliers.concat([
      { name: "Beta Parts", addedBy: "Ana Cruz", addedAt: meta.addedAt },
    ]);
    ctx.prompts[0]({ ok: true, existing: false, localOnly: false, name: "Beta Parts", shared: true });
    assert.equal(chosen, "Beta Parts");
    assert.equal(line.value, "Beta Parts");
    assert.equal(other.value, "Shell");
    assert.ok(values(other).includes("Beta Parts"));
    assert.equal(other.options[other.options.length - 1].value, ctx.api.ADD_SUPPLIER_VALUE);
    assert.equal(ctx.toasts.at(-1), "Beta Parts added.");
  });
});

describe("page script", () => {
  it("still parses", () => {
    const start = html.indexOf("(function(){\n\"use strict\";");
    const end = html.lastIndexOf("</script>");
    assert.ok(start > 0 && end > start);
    new vm.Script(html.slice(start, end));
  });
});
