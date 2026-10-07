"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { handler } = require("../netlify/functions/files");
const { buildUploadPath, assertSafePath } = require("../netlify/functions/files");
const { COOKIE_NAME, signSession } = require("../netlify/lib/session");
const { BUCKET, FILE_SIZE_LIMIT, ensureBucket } = require("../netlify/lib/supabase-storage");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const toml = fs.readFileSync(path.join(__dirname, "../netlify.toml"), "utf8");
const SECRET = "test-hr-session-secret";

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
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

function loadShim(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
  vm.runInNewContext(src, windowLike);
}

function shimWindow(fetchImpl) {
  const window = {
    sessionStorage: {
      _d: {},
      getItem(k) {
        return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null;
      },
      setItem(k, v) {
        this._d[k] = String(v);
      },
      removeItem(k) {
        delete this._d[k];
      },
    },
    document: {
      documentElement: { appendChild() {} },
      head: { appendChild() {} },
      body: { appendChild() {} },
      createElement() {
        return {
          style: {},
          setAttribute() {},
          appendChild() {},
          click() {},
          remove() {},
        };
      },
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      addEventListener() {},
    },
    URLSearchParams,
    fetch: fetchImpl,
    setTimeout,
    console,
  };
  window.window = window;
  return window;
}

function authOk() {
  const payload = {
    authenticated: true,
    methods: ["password"],
    mcp: true,
    capabilities: { mcp: true },
  };
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function staffEvent(method, extra) {
  const token = signSession({ sub: "staff", method: "password" }, SECRET);
  return {
    httpMethod: method,
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
    ...extra,
  };
}

describe("supabase file fallback", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    env = { ...process.env };
    originalFetch = global.fetch;
    process.env.HR_SESSION_SECRET = SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE = "service-role-test";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = env;
  });

  it("builds a private object path and refuses traversal", () => {
    assert.equal(
      buildUploadPath({
        parentId: "1Pp2abc",
        title: "1001 LEAVE SIGNED.pdf",
        now: new Date("2026-10-07T04:00:00Z"),
        id: "11111111-1111-1111-1111-111111111111",
      }),
      "1Pp2abc/2026-10/11111111-1111-1111-1111-111111111111-1001-LEAVE-SIGNED.pdf"
    );
    assert.match(
      buildUploadPath({ parentId: "../secret", title: "../../etc/passwd.pdf" }),
      /^secret\/\d{4}-\d{2}\/[0-9a-f-]{36}-passwd\.pdf$/
    );
    assert.match(buildUploadPath({ parentId: "", title: "" }), /^misc\/\d{4}-\d{2}\/[0-9a-f-]{36}-file$/);
    assert.throws(() => assertSafePath("../etc/passwd"), /not allowed/);
    assert.equal(BUCKET, "hr-uploads");
    assert.equal(FILE_SIZE_LIMIT, 52428800);
    assert.match(toml, /\[functions\.files\]/);
  });

  it("requires the staff session, signs an upload, and redirects a download", async () => {
    const denied = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ op: "upload_url", title: "a.pdf", size: 4, parentId: "inbox" }),
    });
    assert.equal(denied.statusCode, 401);

    const deniedGet = await handler({
      httpMethod: "GET",
      headers: {},
      queryStringParameters: { path: "misc/2026-10/a.pdf" },
    });
    assert.equal(deniedGet.statusCode, 401);

    const calls = [];
    global.fetch = async (url, opts) => {
      const href = String(url);
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      calls.push({ href, method: opts && opts.method, body });
      if (href.endsWith("/storage/v1/bucket")) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ message: "The resource already exists" }),
        };
      }
      if (href.includes("/object/upload/sign/hr-uploads/")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ url: "/object/upload/sign/hr-uploads/inbox/2026-10/file.pdf?token=up" }),
        };
      }
      if (href.includes("/object/sign/hr-uploads/")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ signedURL: "/object/sign/hr-uploads/misc/2026-10/a.pdf?token=down" }),
        };
      }
      throw new Error("unexpected fetch " + href);
    };

    const uploaded = await handler(
      staffEvent("POST", {
        body: JSON.stringify({
          op: "upload_url",
          title: "Leave scan.pdf",
          contentMimeType: "application/pdf",
          size: 1200,
          parentId: "inboxFolder",
        }),
      })
    );
    assert.equal(uploaded.statusCode, 200);
    const up = JSON.parse(uploaded.body);
    assert.match(up.path, /^inboxFolder\/\d{4}-\d{2}\/[0-9a-f-]{36}-Leave-scan\.pdf$/);
    assert.equal(
      up.uploadUrl,
      "https://example.supabase.co/storage/v1/object/upload/sign/hr-uploads/inbox/2026-10/file.pdf?token=up"
    );
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.id, "hr-uploads");
    assert.equal(calls[0].body.public, false);
    assert.equal(calls[0].body.file_size_limit, 52428800);
    assert.match(calls[1].href, /\/object\/upload\/sign\/hr-uploads\//);

    const tooBig = await handler(
      staffEvent("POST", {
        body: JSON.stringify({ op: "upload_url", title: "big.pdf", size: FILE_SIZE_LIMIT + 1 }),
      })
    );
    assert.equal(tooBig.statusCode, 400);
    assert.match(JSON.parse(tooBig.body).error, /50 MB/);

    const sneaky = await handler(
      staffEvent("GET", { queryStringParameters: { path: "misc/../../etc/passwd" } })
    );
    assert.equal(sneaky.statusCode, 400);

    const download = await handler(
      staffEvent("GET", { queryStringParameters: { path: "misc/2026-10/a.pdf" } })
    );
    assert.equal(download.statusCode, 302);
    assert.equal(
      download.headers.location,
      "https://example.supabase.co/storage/v1/object/sign/hr-uploads/misc/2026-10/a.pdf?token=down"
    );
    const signBody = calls.find((c) => c.href.includes("/object/sign/")).body;
    assert.equal(signBody.expiresIn, 120);
  });

  it("treats an already-exists bucket as ready", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ message: "The resource already exists" }),
    });
    assert.deepEqual(await ensureBucket(), { id: "hr-uploads" });
  });

  it("stores a refused Drive file in Supabase and retries Drive on a new session", async () => {
    const storedPath = "inbox/2026-10/id-Leave.pdf";
    function install(drive) {
      const calls = [];
      const window = shimWindow(async (url, opts) => {
        const href = String(url);
        calls.push({ href, method: (opts && opts.method) || "GET", body: opts && opts.body });
        if (href.includes("/functions/auth")) return authOk();
        if (href.includes("/functions/drive")) return drive(href, opts);
        if (href.includes("/functions/files")) {
          return jsonRes(200, {
            uploadUrl: "https://example.supabase.co/storage/v1/object/upload/sign/hr-uploads/" + storedPath + "?token=t",
            path: storedPath,
          });
        }
        if (href.includes("example.supabase.co")) return jsonRes(200, { Key: "hr-uploads/" + storedPath });
        return jsonRes(500, { error: "unexpected " + href });
      });
      loadShim(window);
      return { window, calls };
    }

    const refused = jsonRes(502, {
      error:
        "Google refused domain-wide delegation for GOOGLE_DRIVE_DELEGATED_USER (jeffreycorro@corroconstruction.com). Workspace Admin must grant it.",
      code: "tool_error",
    });
    const first = install(() => refused);
    const mcp = await first.window.claude.use("mcp");
    const out = await mcp.callTool("Google Drive", "create_file", {
      title: "Leave.pdf",
      parentId: "inbox",
      contentMimeType: "application/pdf",
      base64Content: "SGVsbG8=",
    });
    assert.deepEqual(out.payload, {
      id: "",
      title: "Leave.pdf",
      mimeType: "application/pdf",
      viewUrl: "/.netlify/functions/files?path=" + encodeURIComponent(storedPath),
    });
    assert.equal(first.window.sessionStorage.getItem("hr-drive-upload-blocked"), "1");
    const put = first.calls.find((c) => c.href.includes("example.supabase.co"));
    assert.equal(put.method, "PUT");
    assert.equal(put.body.length, 5);
    const filePost = first.calls.find((c) => c.href.includes("/functions/files"));
    assert.equal(JSON.parse(filePost.body).size, 5);
    assert.equal(JSON.parse(filePost.body).parentId, "inbox");

    first.calls.length = 0;
    const again = await mcp.callTool("Google Drive", "create_file", {
      title: "Leave2.pdf",
      parentId: "inbox",
      contentMimeType: "application/pdf",
      base64Content: "SGVsbG8=",
    });
    assert.equal(again.payload.id, "");
    assert.match(again.payload.viewUrl, /^\/\.netlify\/functions\/files\?path=/);
    assert.equal(first.calls.some((c) => c.href.includes("/functions/drive")), false);

    const fresh = install(() =>
      jsonRes(200, {
        payload: {
          id: "drive1",
          title: "Leave.pdf",
          mimeType: "application/pdf",
          viewUrl: "https://drive.google.com/file/d/drive1/view",
        },
      })
    );
    const mcp2 = await fresh.window.claude.use("mcp");
    const driveOut = await mcp2.callTool("Google Drive", "create_file", {
      title: "Leave.pdf",
      parentId: "inbox",
      contentMimeType: "application/pdf",
      base64Content: "SGVsbG8=",
    });
    assert.equal(driveOut.payload.viewUrl, "https://drive.google.com/file/d/drive1/view");
    assert.equal(fresh.window.sessionStorage.getItem("hr-drive-upload-blocked"), null);
    assert.equal(fresh.calls.some((c) => c.href.includes("/functions/files")), false);
  });

  it("does not fall back for folders or unrelated errors, and says why when both stores fail", async () => {
    const calls = [];
    const window = shimWindow(async (url, opts) => {
      const href = String(url);
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      calls.push({ href, tool: body.tool, op: body.op });
      if (href.includes("/functions/auth")) return authOk();
      if (href.includes("/functions/drive")) {
        if (body.args && body.args.contentMimeType === "application/vnd.google-apps.folder") {
          return jsonRes(403, { error: "storage quota", code: "quota_exceeded" });
        }
        if (body.args && body.args.title === "bad") {
          return jsonRes(400, { error: "title is required", code: "bad_request" });
        }
        return jsonRes(403, {
          error: "The user's Drive storage quota has been exceeded.",
          code: "quota_exceeded",
        });
      }
      if (href.includes("/functions/files")) return jsonRes(500, { error: "bucket create failed", code: "upstream_error" });
      return jsonRes(500, { error: "no" });
    });
    loadShim(window);
    const mcp = await window.claude.use("mcp");

    await assert.rejects(
      () =>
        mcp.callTool("Google Drive", "create_file", {
          title: "Ada",
          parentId: "root",
          contentMimeType: "application/vnd.google-apps.folder",
        }),
      (err) => err.code === "quota_exceeded"
    );
    assert.equal(calls.some((c) => c.href.includes("/functions/files")), false);

    await assert.rejects(
      () =>
        mcp.callTool("Google Drive", "create_file", {
          title: "bad",
          parentId: "root",
          contentMimeType: "application/pdf",
          base64Content: "SGVsbG8=",
        }),
      (err) => err.code === "bad_request" && /title is required/.test(err.message)
    );
    assert.equal(calls.some((c) => c.href.includes("/functions/files")), false);

    await assert.rejects(
      () =>
        mcp.callTool("Google Drive", "create_file", {
          title: "scan.pdf",
          parentId: "root",
          contentMimeType: "application/pdf",
          base64Content: "SGVsbG8=",
        }),
      (err) => {
        assert.equal(err.code, "upload_failed");
        assert.match(err.message, /^The file could not be stored\. bucket create failed/);
        assert.doesNotMatch(err.message, /Workspace Admin/);
        return true;
      }
    );
    assert.equal(window.sessionStorage.getItem("hr-drive-upload-blocked"), "1");
  });

  it("keeps older OT and stamped data URLs, and skips OCR when there is no Drive id", () => {
    assert.match(html, /const BUILD = "2026-10-07c"/);
    const store = extractFunction(html, "storeOtFile");
    assert.match(store, /create_file/);
    assert.doesNotMatch(store, /1500000|1\.5 MB|readAsDataURL/);
    const read = extractFunction(html, "readSignedScan");
    assert.match(read, /not in Google Drive/);
    assert.match(read, /Open the file and check it yourself/);
    const names = [
      "isEphemeralUrl",
      "isHeavyDataUrl",
      "durableDriveUrl",
      "otSiteKey",
      "otFileKey",
      "otFormFiles",
      "otFormUrl",
      "otRequestCovers",
      "otCovered",
    ];
    const ctx = { S: { otreqs: {} } };
    vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
    const dataUrl = "data:application/pdf;base64,SGVsbG8=";
    const stored = "/.netlify/functions/files?path=" + encodeURIComponent("misc/2026-10/ot.pdf");
    ctx.S.otreqs = {
      old: {
        id: "old",
        from: "2026-10-07",
        to: "2026-10-07",
        site: "Danlag",
        wholeSite: true,
        status: "Approved",
        formUrl: dataUrl,
      },
    };
    assert.equal(ctx.otFormFiles(ctx.S.otreqs.old)[0].url, dataUrl);
    assert.equal(ctx.otCovered("e1", "2026-10-07", "Danlag"), true);
    ctx.S.otreqs.old.formUrl = stored;
    assert.equal(ctx.otCovered("e1", "2026-10-07", "Danlag"), true);

    const msgCtx = { hostedSite() { return true; } };
    vm.runInNewContext(extractFunction(html, "driveMessage"), msgCtx);
    assert.equal(
      msgCtx.driveMessage({ code: "upload_failed", message: "The file could not be stored. bucket create failed." }),
      "The file could not be stored. bucket create failed."
    );
    const quota = msgCtx.driveMessage({
      code: "quota_exceeded",
      message: "Google Drive storage is full for GOOGLE_DRIVE_DELEGATED_USER (hr@example.com). Workspace Admin must grant domain-wide delegation.",
    });
    assert.match(quota, /storage is full/);
    assert.doesNotMatch(quota, /Workspace Admin/);
  });
});
