/**
 * Shared payroll approval steps for the Payroll Maker buttons and the
 * HR bot. Submit, acknowledge exceptions, and Finalize call these
 * functions. The bot runs all three. The buttons keep their own
 * actor, unlock, and who.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.hrBotApprove = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var APPROVER_NAME = "Jeffrey James M. Corro";
  var VIA = "HR Bot";

  function globalOf(name) {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (g && typeof g[name] === "function") return g[name];
    return null;
  }

  function transitionOf(ctx) {
    if (ctx && typeof ctx.transition === "function") return ctx.transition;
    return globalOf("payTransition");
  }

  function statusOf(ctx) {
    if (ctx && typeof ctx.statusOf === "function") return ctx.statusOf;
    return globalOf("payRunStatusOf");
  }

  function cloneOf(ctx) {
    if (ctx && typeof ctx.cloneRun === "function") return ctx.cloneRun;
    var fn = globalOf("payCloneRun");
    if (fn) return fn;
    return function (run) {
      var next = {};
      Object.keys(run || {}).forEach(function (k) { next[k] = run[k]; });
      return next;
    };
  }

  function openExceptionsOf(ctx) {
    if (ctx && typeof ctx.openExceptions === "function") return ctx.openExceptions;
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var sheet = g && g.hrPaySheet;
    if (sheet && typeof sheet.openExceptions === "function") {
      return function (lines, ack) { return sheet.openExceptions(lines, ack); };
    }
    return function () { return []; };
  }

  function missing(run) {
    return { ok: false, error: "Payroll approval is not loaded.", run: run || null };
  }

  function submitStep(run, ctx) {
    ctx = ctx || {};
    var transition = transitionOf(ctx);
    if (!transition) return missing(run);
    return transition(run, "submit", {
      actor: ctx.actor || null,
      approverUnlocked: ctx.approverUnlocked === true,
      now: ctx.now || "",
      who: ctx.who || ""
    });
  }

  function acknowledgeStep(run, lines, today, ctx) {
    ctx = ctx || {};
    var clone = cloneOf(ctx);
    var openFn = openExceptionsOf(ctx);
    var open = openFn(lines || [], {}) || [];
    var next = clone(run || {});
    var ack = Object.assign({}, next.exceptionsAck || {});
    open.forEach(function (ex) {
      if (ex && ex.id) ack[ex.id] = today || "";
    });
    next.exceptionsAck = ack;
    return { ok: true, error: "", run: next, acknowledged: open.length };
  }

  function approveStep(run, lines, ctx) {
    ctx = ctx || {};
    var transition = transitionOf(ctx);
    if (!transition) return missing(run);
    var openFn = openExceptionsOf(ctx);
    var open = openFn(lines || [], (run && run.exceptionsAck) || {}) || [];
    if (open.length) {
      return {
        ok: false,
        error: open.length + " exception" + (open.length === 1 ? "" : "s") + " still open. Acknowledge them before approval.",
        run: run || null
      };
    }
    return transition(run, "approve", {
      actor: ctx.actor || null,
      approverUnlocked: ctx.approverUnlocked === true,
      now: ctx.now || "",
      who: ctx.who || "",
      snapshot: ctx.snapshot || null
    });
  }

  /**
   * Draft → submit → acknowledge every open exception → approve.
   * A submitted run skips submit. An approved run is left as stored.
   */
  function approveThroughFinalize(run, lines, ctx) {
    ctx = ctx || {};
    var readStatus = statusOf(ctx);
    if (!readStatus || !transitionOf(ctx)) return missing(run);
    var current = readStatus(run);
    if (current === "approved") {
      return { ok: true, error: "", run: run, steps: [], already: true, from: "approved" };
    }
    var next = run;
    var steps = [];
    if (current === "draft") {
      var submitted = submitStep(next, ctx);
      if (!submitted.ok) return submitted;
      next = submitted.run;
      steps.push("submit");
    } else if (current !== "submitted") {
      return { ok: false, error: "Only a draft or a submitted run can be approved.", run: run || null };
    }
    var acked = acknowledgeStep(next, lines, ctx.today, ctx);
    if (!acked.ok) return acked;
    next = acked.run;
    steps.push("acknowledge");
    var approved = approveStep(next, lines, ctx);
    if (!approved.ok) return approved;
    steps.push("approve");
    return {
      ok: true,
      error: "",
      run: approved.run,
      steps: steps,
      already: false,
      from: current,
      acknowledged: acked.acknowledged
    };
  }

  function projectSummary(lines, deps) {
    deps = deps || {};
    var summaryFn = deps.payProjectSummary || globalOf("payProjectSummary");
    if (!summaryFn) return null;
    var settings = deps.settings || {};
    var aliasFn = deps.payAliasConfirmedMap || globalOf("payAliasConfirmedMap");
    var confirmed = {};
    if (aliasFn) {
      try { confirmed = aliasFn(settings) || {}; } catch (e) { confirmed = {}; }
    }
    var late = deps.lateForRow;
    if (typeof late !== "function") {
      var g = typeof globalThis !== "undefined" ? globalThis : null;
      var sheet = g && g.hrPaySheet;
      if (sheet && typeof sheet.lateForRow === "function") late = sheet.lateForRow;
    }
    return summaryFn(lines || [], {
      confirmed: confirmed,
      extraProjects: deps.extraProjects || [],
      otPolicy: Number(settings.otPolicy != null ? settings.otPolicy : 1) || 1,
      lateForRow: typeof late === "function" ? late : null
    });
  }

  function approvalSnapshot(summary) {
    if (!summary) return null;
    return { totals: summary.totals, sites: summary.sites };
  }

  return {
    APPROVER_NAME: APPROVER_NAME,
    VIA: VIA,
    submitStep: submitStep,
    acknowledgeStep: acknowledgeStep,
    approveStep: approveStep,
    approveThroughFinalize: approveThroughFinalize,
    projectSummary: projectSummary,
    approvalSnapshot: approvalSnapshot
  };
});
