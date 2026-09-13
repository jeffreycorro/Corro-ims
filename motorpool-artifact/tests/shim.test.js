"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadShim(windowLike) {
  const src = fs.readFileSync(
    path.join(__dirname, "../public/claude-shim.js"),
    "utf8"
  );
  vm.runInNewContext(src, windowLike);
}

function fakeWindow() {
  const clicks = [];
  const window = {
    sessionStorage: {
      _d: {},
      getItem(k) {
        return this._d[k] || null;
      },
      setItem(k, v) {
        this._d[k] = String(v);
      },
    },
    document: {
      documentElement: { appendChild() {} },
      head: { appendChild() {} },
      body: {
        appendChild(el) {
          clicks.push(el);
        },
      },
      createElement(tag) {
        const el = {
          tagName: tag,
          style: { cssText: "" },
          click() {
            clicks.push(el);
          },
          remove() {},
          setAttribute() {},
        };
        return el;
      },
      querySelector() {
        return null;
      },
      getElementById() {
        return null;
      },
      addEventListener() {},
    },
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    Blob: class FakeBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || "";
      }
    },
    fetch() {
      return Promise.resolve({
        ok: true,
        json: async () => ({ authenticated: true, methods: ["password"] }),
        text: async () =>
          JSON.stringify({ authenticated: true, methods: ["password"] }),
      });
    },
    setTimeout,
    console,
  };
  window.window = window;
  window.clicks = clicks;
  return window;
}

describe("claude shim", () => {
  it("installs use() that returns a Promise synchronously", () => {
    const w = fakeWindow();
    loadShim(w);
    const p = w.claude.use("db");
    assert.equal(typeof w.claude.use, "function");
    assert.equal(typeof p.then, "function");
    assert.equal(w.claude.use("db"), p);
  });

  it("returns null for sample and unknown capabilities", async () => {
    const w = fakeWindow();
    loadShim(w);
    assert.equal(await w.claude.use("sample"), null);
    assert.equal(await w.claude.use("mcp"), null);
    assert.equal(await w.claude.use("nope"), null);
  });

  it("exposes doc get/set/delete/acquire and collection get", async () => {
    const w = fakeWindow();
    const calls = [];
    w.fetch = (url, opts) => {
      calls.push({ url, body: JSON.parse((opts && opts.body) || "{}") });
      if (String(url).includes("/auth")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ authenticated: true, methods: [] }),
          text: async () => JSON.stringify({ authenticated: true, open: true }),
        });
      }
      const body = JSON.parse((opts && opts.body) || "{}");
      if (body.op === "get") {
        return Promise.resolve({
          ok: true,
          text: async () =>
            JSON.stringify({ id: "app", exists: true, data: { nextVrf: 1 } }),
        });
      }
      if (body.op === "list") {
        return Promise.resolve({
          ok: true,
          text: async () =>
            JSON.stringify({
              docs: [{ id: "vehicles", exists: true, data: { rows: [] } }],
            }),
        });
      }
      if (body.op === "acquire") {
        return Promise.resolve({
          ok: true,
          text: async () =>
            JSON.stringify({ acquired: true, holder: body.holder, expires_at: "t" }),
        });
      }
      return Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({ id: "1", exists: true, data: body.data || {} }),
      });
    };
    loadShim(w);
    const db = await w.claude.use("db");
    const snap = await db.doc("config/app").get();
    assert.equal(snap.exists, true);
    assert.equal(snap.data().nextVrf, 1);
    await db.doc("master/vehicles").set({ rows: [] });
    const lock = await db.doc("config/counter").acquire({ holder: "h1" });
    assert.equal(lock.acquired, true);
    const col = await db.collection("master").get();
    assert.equal(col.docs[0].id, "vehicles");
    const ops = calls.filter((c) => String(c.url).includes("/db")).map((c) => c.body.op);
    assert.ok(ops.includes("get"));
    assert.ok(ops.includes("set"));
    assert.ok(ops.includes("acquire"));
    assert.ok(ops.includes("list"));
  });

  it("treats a missing auth function as an open local yard", async () => {
    const w = fakeWindow();
    const appended = [];
    w.document.documentElement.appendChild = (el) => appended.push(el);
    w.fetch = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: async () => {
          throw new Error("not json");
        },
        text: async () => "Not Found",
      });
    loadShim(w);
    const db = await w.claude.use("db");
    assert.equal(db, null);
    assert.equal(
      appended.some((el) => el && el.id === "mp-shim-gate-host"),
      false
    );
  });

  it("downloads.save uses an object URL and anchor click", async () => {
    const w = fakeWindow();
    loadShim(w);
    const downloads = await w.claude.use("downloads");
    await downloads.save({ filename: "VRF-1.html", data: "<html></html>" });
    const saved = w.clicks.find((el) => el.download === "VRF-1.html");
    assert.ok(saved, "downloads.save must click an anchor");
    assert.equal(saved.href, "blob:test");
  });
});
