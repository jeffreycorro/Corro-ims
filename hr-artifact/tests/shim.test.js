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
  const created = [];
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
      body: {
        appendChild(el) {
          created.push(el);
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
        };
        return el;
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
    const again = w.claude.use("db");
    assert.equal(p, again);
  });

  it("returns null for sample and mcp when auth does not advertise them", async () => {
    const w = fakeWindow();
    loadShim(w);
    assert.equal(await w.claude.use("sample"), null);
    assert.equal(await w.claude.use("mcp"), null);
    assert.equal(await w.claude.use("nope"), null);
  });

  it("exposes sample and mcp when auth reports those capabilities", async () => {
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
            methods: ["password"],
            capabilities: { sample: true, mcp: true },
          }),
          text: async () =>
            JSON.stringify({
              authenticated: true,
              capabilities: { sample: true, mcp: true },
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
                toolCalls: [{ id: "t1", name: "find_employee", input: { query: "ada" } }],
                assistantContent: [
                  { type: "tool_use", id: "t1", name: "find_employee", input: { query: "ada" } },
                ],
                text: "",
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({ text: "Draft body", truncated: false }),
        });
      }
      if (String(url).includes("/drive")) {
        return Promise.resolve({
          ok: true,
          text: async () =>
            JSON.stringify({
              payload: {
                files: [
                  {
                    id: "f1",
                    title: "Resume.pdf",
                    mimeType: "application/pdf",
                    viewUrl: "https://drive.google.com/file/d/f1/view",
                  },
                ],
              },
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
    const drafted = await sample("Write a memo", {
      modelTier: "default",
      onText({ text }) {
        seen.push(text);
      },
    });
    assert.equal(drafted.text, "Draft body");
    assert.deepEqual(seen, ["Draft body"]);
    const parsed = await sample.json("return json");
    assert.equal(parsed.ok, true);

    let executed = 0;
    const asked = await sample([{ role: "user", content: "Who is Ada?" }], {
      tools: [
        {
          name: "find_employee",
          description: "find",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
          execute() {
            executed += 1;
            return { matches: [{ name: "Ada" }] };
          },
        },
      ],
    });
    assert.equal(executed, 1);
    assert.equal(asked.text, "Draft body");

    const mcp = await w.claude.use("mcp");
    const listed = await mcp.callTool("Google Drive", "search_files", {
      query: "parentId = 'abc'",
      pageSize: 10,
    });
    assert.equal(listed.payload.files[0].id, "f1");
    const unknown = await mcp.callTool("Other", "search_files", {}).then(
      () => null,
      (err) => err
    );
    assert.equal(unknown.code, "server_not_found");
    const driveCalls = calls.filter((c) => String(c.url).includes("/drive"));
    assert.equal(driveCalls[0].body.tool, "search_files");
  });

  it("attaches server error codes so the artifact can map them", async () => {
    const w = fakeWindow();
    w.fetch = (url) => {
      if (String(url).includes("/auth")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            authenticated: true,
            capabilities: { sample: true, mcp: true },
          }),
          text: async () =>
            JSON.stringify({ authenticated: true, capabilities: { sample: true, mcp: true } }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: "slow down", code: "rate_limited" }),
      });
    };
    loadShim(w);
    const sample = await w.claude.use("sample");
    await assert.rejects(() => sample("hi"), (err) => {
      assert.equal(err.code, "rate_limited");
      return true;
    });
  });

  it("exposes doc get/set/delete/acquire and collection get/onSnapshot", async () => {
    const w = fakeWindow();
    const calls = [];
    w.fetch = (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body || "{}") });
      if (String(url).includes("/auth")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ authenticated: true, methods: ["password"] }),
          text: async () => JSON.stringify({ authenticated: true }),
        });
      }
      const body = JSON.parse(opts.body || "{}");
      if (body.op === "get") {
        return Promise.resolve({
          ok: true,
          text: async () =>
            JSON.stringify({ id: "settings", exists: true, data: { theme: "dark" } }),
        });
      }
      if (body.op === "list") {
        return Promise.resolve({
          ok: true,
          text: async () =>
            JSON.stringify({
              docs: [{ id: "1", exists: true, data: { name: "x" } }],
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
    const snap = await db.doc("meta/settings").get();
    assert.equal(snap.exists, true);
    assert.equal(snap.data().theme, "dark");
    await db.doc("employees/1").set({ name: "Ada" });
    await db.doc("employees/1").delete();
    const lock = await db.doc("employees/1").acquire({ holder: "h1" });
    assert.equal(lock.acquired, true);
    const col = await db.collection("employees").get();
    assert.equal(col.docs.length, 1);
    assert.equal(col.docs[0].data().name, "x");
    const unsub = db.collection("employees").onSnapshot(function () {});
    assert.equal(typeof unsub, "function");
    unsub();
    const ops = calls.filter((c) => c.url.includes("/db")).map((c) => c.body.op);
    assert.deepEqual(ops.slice(0, 5), ["get", "set", "delete", "acquire", "list"]);
  });

  it("downloads.save uses an object URL and anchor click", async () => {
    const w = fakeWindow();
    loadShim(w);
    const downloads = await w.claude.use("downloads");
    await downloads.save({ filename: "note.txt", data: "hello" });
    assert.equal(w.clicks.length, 1);
    assert.equal(w.clicks[0].download, "note.txt");
    assert.equal(w.clicks[0].href, "blob:test");
  });
});
