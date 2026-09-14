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

  it("returns null for sample, tts, and unknown capabilities", async () => {
    const w = fakeWindow();
    loadShim(w);
    assert.equal(await w.claude.use("sample"), null);
    assert.equal(await w.claude.use("tts"), null);
    assert.equal(await w.claude.use("mcp"), null);
    assert.equal(await w.claude.use("nope"), null);
  });

  it("exposes sample and tts when auth reports those capabilities", async () => {
    const w = fakeWindow();
    const calls = [];
    w.fetch = (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      calls.push({ url, body });
      if (String(url).includes("/auth")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            authenticated: true,
            methods: [],
            capabilities: { sample: true, tts: true },
          }),
          text: async () =>
            JSON.stringify({
              authenticated: true,
              capabilities: { sample: true, tts: true },
            }),
        });
      }
      if (String(url).includes("/sample")) {
        if (body.mode === "json") {
          return Promise.resolve({
            ok: true,
            text: async () => JSON.stringify({ json: { ok: true }, text: '{"ok":true}' }),
          });
        }
        if (body.tools && body.tools.length && !(body.messages || []).some((m) => Array.isArray(m.content))) {
          return Promise.resolve({
            ok: true,
            text: async () =>
              JSON.stringify({
                toolCalls: [{ id: "t1", name: "find_unit", input: { query: "DT-03" } }],
                assistantContent: [
                  { type: "tool_use", id: "t1", name: "find_unit", input: { query: "DT-03" } },
                ],
                text: "",
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({ text: "Last battery was in October.", truncated: false }),
        });
      }
      if (String(url).includes("/tts")) {
        return Promise.resolve({
          ok: true,
          text: async () =>
            JSON.stringify({
              audioBase64: Buffer.from("fake-mp3").toString("base64"),
              mimeType: "audio/mpeg",
              voiceId: "voice-1",
            }),
        });
      }
      return Promise.resolve({ ok: true, text: async () => "{}" });
    };
    loadShim(w);
    const sample = await w.claude.use("sample");
    assert.equal(typeof sample, "function");
    assert.equal(typeof sample.json, "function");
    const limits = await sample.limits();
    assert.equal(limits.tools.maxCount, 8);
    const seen = [];
    const drafted = await sample("DT-03 battery?", {
      modelTier: "default",
      onText({ text }) {
        seen.push(text);
      },
    });
    assert.equal(drafted.text, "Last battery was in October.");
    assert.deepEqual(seen, ["Last battery was in October."]);
    const parsed = await sample.json("return json");
    assert.equal(parsed.ok, true);

    let executed = 0;
    const asked = await sample([{ role: "user", content: "DT-03?" }], {
      tools: [
        {
          name: "find_unit",
          description: "find",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
          execute() {
            executed += 1;
            return { code: "DT-03" };
          },
        },
      ],
    });
    assert.equal(executed, 1);
    assert.equal(asked.text, "Last battery was in October.");

    const tts = await w.claude.use("tts");
    const spoken = await tts("DT-03 is due for oil.");
    assert.equal(spoken.mimeType, "audio/mpeg");
    assert.ok(spoken.audioBase64);
    const ttsCalls = calls.filter((c) => String(c.url).includes("/tts"));
    assert.equal(ttsCalls[0].body.text, "DT-03 is due for oil.");
    assert.equal(await w.claude.use("speak"), tts);
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
