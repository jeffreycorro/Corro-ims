"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { decideLock } = require("../netlify/lib/locks");

describe("acquire lock", () => {
  const now = new Date("2026-09-07T08:00:00+08:00");

  it("grants a free or expired lock and never invents acquired:true for a busy lock", () => {
    assert.equal(decideLock(null, "alice", now).acquired, true);
    assert.equal(
      decideLock(
        { holder: "bob", expires_at: "2026-09-07T00:00:00.000Z" },
        "alice",
        now
      ).acquired,
      true
    );
    const busy = decideLock(
      { holder: "bob", expires_at: "2026-09-07T12:00:00.000Z" },
      "alice",
      now
    );
    assert.equal(busy.acquired, false);
    assert.equal(busy.holder, "bob");
  });

  it("lets the same holder refresh", () => {
    const result = decideLock(
      { holder: "alice", expires_at: "2026-09-07T12:00:00.000Z" },
      "alice",
      now
    );
    assert.equal(result.acquired, true);
    assert.equal(result.refreshed, true);
  });

  it("refuses an empty holder", () => {
    assert.equal(decideLock(null, "  ", now).acquired, false);
  });

  it("SQL RPC returns acquired false when the update is skipped", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/20260907000002_hr_artifact_docs.sql"),
      "utf8"
    );
    assert.match(sql, /'acquired', false/);
    assert.match(sql, /create table if not exists public\.locks/);
    assert.match(sql, /acquire_doc_lock/);
    assert.doesNotMatch(sql, /acquired',\s*true\s*\)[\s\S]*always/);
    assert.match(sql, /no anonymous read|No policies for `anon`/i);
  });
});
