"use strict";

/**
 * Liquidated VRF print variance.
 * Approved pesos and litres come from the sealed issued snapshot
 * (qty × price on snapshot.rows). approvedBudget is only a fallback,
 * and that fallback is labeled.
 * The 10% flag is a separate notice and is not decided here.
 */

const VARIANCE_TOL_DEFAULT = 0.1;
const VARIANCE_PRINT_MAX = 0.5;

const VRF_PREVIEW_MARK = "NOT APPROVED \u2013 PREVIEW ONLY";
const VRF_VARIANCE_PREVIEW_MARK = "VARIANCE NOT APPROVED \u2013 PREVIEW ONLY";
const VRF_PROOF_PREVIEW_MARK = "LIQUIDATION NOT PROVED \u2013 PREVIEW ONLY";
const VRF_ORIGINAL_MARK = "APPROVED \u2013 ORIGINAL";
const VRF_LIQUIDATED_MARK = "LIQUIDATED";
const APPROVED_BUDGET_LABEL =
  "Approved amount from the reserve budget — no sealed snapshot on file.";

function moneyNum(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[₱,\s]/g, "").trim());
  return isFinite(n) ? n : 0;
}

function lineMoney(l) {
  if (!l) return 0;
  const q = moneyNum(l.qty);
  const p = moneyNum(l.price);
  if (q || p) return q * p;
  return moneyNum(l.total);
}

function isFuel(text) {
  return /^\s*fuel\s*[—–-]/i.test(text == null ? "" : text);
}

function fuelLitresOf(r) {
  if (!r) return 0;
  const raw =
    r.liters != null && r.liters !== ""
      ? r.liters
      : r.litres != null && r.litres !== ""
        ? r.litres
        : "";
  const L = parseFloat(raw);
  if (isFinite(L) && L > 0) return L;
  const unit = String(r.unit || "")
    .trim()
    .toLowerCase();
  if (unit === "l" || unit === "lt" || unit === "ltr" || unit === "liter" || unit === "litre" || unit === "liters" || unit === "litres") {
    const q = parseFloat(r.qty);
    if (isFinite(q) && q > 0) return q;
  }
  return 0;
}

function sumLineMoney(rows) {
  let t = 0;
  (rows || []).forEach(function (r) {
    if (!r || r.notBought) return;
    t += lineMoney(r);
  });
  return t;
}

function sumFuelLitres(rows) {
  let t = 0;
  (rows || []).forEach(function (r) {
    if (!r || r.notBought || !isFuel(r.cat)) return;
    t += fuelLitresOf(r);
  });
  return t;
}

function pesosSame(a, b) {
  return Math.round(moneyNum(a) * 100) === Math.round(moneyNum(b) * 100);
}

function formatVariancePct(pct) {
  let n = Number(pct) * 100;
  if (!isFinite(n)) n = 0;
  const sign = n > 0 ? "+" : "";
  const abs = Math.abs(n);
  let body;
  if (Math.abs(abs - Math.round(abs)) < 0.005) body = String(Math.round(n));
  else if (Math.abs(abs * 10 - Math.round(abs * 10)) < 0.05) body = n.toFixed(1);
  else body = n.toFixed(2);
  return sign + body + "%";
}

function varianceOverrun(approved, actual) {
  const appr = moneyNum(approved);
  const act = moneyNum(actual);
  const diff = act - appr;
  const pct = appr > 0 ? diff / appr : act > 0 ? 1 : 0;
  return { approved: appr, actual: act, diff: diff, pct: pct };
}

/** Above 50% of the approved pesos. Exactly 50% is not blocked. */
function variancePrintBlocked(approved, actual) {
  const appr = moneyNum(approved);
  const act = moneyNum(actual);
  if (!(appr > 0)) return act > 0;
  return act > appr * (1 + VARIANCE_PRINT_MAX);
}

function variancePrintMessage(pct) {
  return (
    "Variance " +
    formatVariancePct(pct) +
    " needs Jeffrey's approval before the liquidated VRF can print"
  );
}

function issuedNumbers(issued) {
  if (!issued) return {};
  if (issued.numbers && typeof issued.numbers === "object") return issued.numbers;
  return issued;
}

function sealMatchesVrf(key, row, vrfNo) {
  const no = String(vrfNo || "").trim();
  if (!no || !row) return false;
  const eno = String(row.no || "").trim();
  const keyNo = String(key || "").split("@")[0];
  return eno === no || keyNo === no;
}

/** Latest sealed issued:<VRF> or issued:<VRF>@reserve row that still has snapshot lines. */
function latestVrfSeal(vrfNo, issued) {
  const nums = issuedNumbers(issued);
  const no = String(vrfNo || "").trim();
  if (!no) return null;
  let best = null;
  let bestAt = "";
  Object.keys(nums).forEach(function (k) {
    const row = nums[k];
    if (!row || !row.snapshot || !(row.snapshot.rows || []).length) return;
    if (!sealMatchesVrf(k, row, no)) return;
    const at = String(row.at || "");
    if (!best || at >= bestAt) {
      best = row;
      bestAt = at;
    }
  });
  return best;
}

function rowsOf(list) {
  return (list || []).filter(function (r) {
    return r && (r.cat || r.item || r.qty || r.price || r.total);
  });
}

/**
 * Approved basis for one VRF. Snapshot qty/price wins.
 * Falls back to approvedBudget (then budget) and says so.
 */
function originalApprovedSource(vrfNo, issued, reserve) {
  const seal = latestVrfSeal(vrfNo, issued);
  const snapRows = seal && seal.snapshot ? rowsOf(seal.snapshot.rows) : [];
  if (snapRows.length) {
    return {
      source: "snapshot",
      label: "",
      rows: snapRows,
      amount: sumLineMoney(snapRows),
      liters: sumFuelLitres(snapRows),
      seal: seal,
    };
  }
  const budget =
    reserve && reserve.approvedBudget != null
      ? moneyNum(reserve.approvedBudget)
      : moneyNum(reserve && reserve.budget);
  const drafts = rowsOf(reserve && reserve.draftLines).map(function (l) {
    const qty = moneyNum(l.qty);
    const price = moneyNum(l.price);
    return Object.assign({}, l, {
      qty: qty,
      price: price,
      total: qty || price ? qty * price : moneyNum(l.total),
    });
  });
  const fromLines = sumLineMoney(drafts);
  const amount = budget > 0 ? budget : fromLines;
  if (reserve && (budget > 0 || drafts.length)) {
    return {
      source: "approvedBudget",
      label: APPROVED_BUDGET_LABEL,
      rows: drafts,
      amount: amount,
      liters: sumFuelLitres(drafts),
      seal: null,
    };
  }
  return {
    source: "missing",
    label: "No sealed snapshot or reserve budget is on file for the original amounts.",
    rows: [],
    amount: 0,
    liters: 0,
    seal: null,
  };
}

function fuelLiterNotice(approvedLiters, actualLiters, approvedPesos, actualPesos) {
  const aL = Number(approvedLiters) || 0;
  const sL = Number(actualLiters) || 0;
  const differ = Math.abs(sL - aL) > 0.001;
  const over = sL > aL + 0.001;
  const samePesos = pesosSame(approvedPesos, actualPesos);
  const flag = over || (samePesos && differ && (aL > 0 || sL > 0));
  let note = "";
  if (over) {
    note = "Litres are over the approved amount. This is a notice only — it does not block printing.";
  } else if (samePesos && differ) {
    note = "Pesos match the approved amount, but litres differ. This is a notice only — it does not block printing.";
  }
  return {
    flag: flag,
    block: false,
    approvedLiters: aL,
    actualLiters: sL,
    over: over,
    pesosSame: samePesos,
    note: note,
  };
}

function changeOwedAmount(approved, actual) {
  const appr = moneyNum(approved);
  const act = moneyNum(actual);
  if (act < appr - 0.004) return Math.round((appr - act) * 100) / 100;
  return 0;
}

function varianceApprovalOn(reserve) {
  return !!(
    reserve &&
    String(reserve.varianceApprovedBy || "").trim() &&
    String(reserve.varianceApprovedAt || "").trim()
  );
}

function liquidatedVariance(actualRows, approvedSource, reserve) {
  const approved = approvedSource ? approvedSource.amount : 0;
  const actual = sumLineMoney(actualRows);
  const base = varianceOverrun(approved, actual);
  const fuel = fuelLiterNotice(
    approvedSource ? approvedSource.liters : 0,
    sumFuelLitres(actualRows),
    base.approved,
    base.actual
  );
  const blocked = variancePrintBlocked(base.approved, base.actual);
  const approvedAlready = varianceApprovalOn(reserve);
  return {
    approved: base.approved,
    actual: base.actual,
    diff: base.diff,
    pct: base.pct,
    source: approvedSource ? approvedSource.source : "missing",
    label: approvedSource ? approvedSource.label || "" : "",
    fuel: fuel,
    changeOwed: changeOwedAmount(base.approved, base.actual),
    overPrintMax: blocked,
    printBlocked: blocked && !approvedAlready,
    varianceApproved: approvedAlready,
    message: blocked ? variancePrintMessage(base.pct) : "",
  };
}

function isFuelReserveSupplier(s) {
  return String(s == null ? "" : s)
    .trim()
    .toUpperCase() === "FUEL RESERVE";
}

function vrfIsFuelReserveDraw(entry, reserve) {
  const rows = (entry && entry.rows) || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    if (isFuelReserveSupplier(row.supplier)) return true;
    if (String(row.work || "").toUpperCase() === "FUEL-RES") return true;
  }
  if (reserve) {
    if (String(reserve.kind || "") === "fuel-issue") return true;
    if (isFuelReserveSupplier(reserve.supplier)) return true;
    if (String(reserve.work || "").toUpperCase() === "FUEL-RES") return true;
  }
  return false;
}

/**
 * Liquidated print needs at least one photo.
 * A FUEL RESERVE draw also needs a gauge photo. That does not change
 * Send for approval, where the gauge photo stays optional.
 */
function liquidationProofGate(spec) {
  spec = spec || {};
  const photos = Number(spec.photoCount) || 0;
  const fuelReserve = !!spec.fuelReserve;
  const gauge = !!spec.gauge;
  if (photos < 1) {
    return {
      ok: false,
      block: true,
      previewMark: VRF_PROOF_PREVIEW_MARK,
      message: "Liquidated VRF cannot print until at least one photo is on the VRF.",
    };
  }
  if (fuelReserve && !gauge) {
    return {
      ok: false,
      block: true,
      previewMark: VRF_PROOF_PREVIEW_MARK,
      message:
        "Liquidated VRF cannot print until a fuel-gauge photo is on this FUEL RESERVE draw.",
    };
  }
  return { ok: true, block: false, previewMark: "", message: "" };
}

function liquidatedPrintBlock(variance, proof) {
  const messages = [];
  let previewMark = "";
  if (variance && variance.printBlocked) {
    messages.push(variance.message || variancePrintMessage(variance.pct));
    previewMark = VRF_VARIANCE_PREVIEW_MARK;
  }
  if (proof && proof.block) {
    messages.push(proof.message);
    if (!previewMark) previewMark = proof.previewMark || VRF_PROOF_PREVIEW_MARK;
  }
  return {
    print: messages.length > 0,
    messages: messages,
    previewMark: previewMark,
  };
}

function vrfWasNeverApproved(entry) {
  if (!entry) return true;
  const st = String(entry.status || "").trim().toLowerCase();
  if (!st || st === "requested" || st === "draft" || st === "pending" || st === "rejected" || st === "disapproved" || st === "for approval") {
    return true;
  }
  if (entry.unnumbered || /not yet posted/i.test(String(entry.vrf || ""))) return true;
  return false;
}

function editionStamp(entry, edition, block) {
  if (edition === "original") {
    if (vrfWasNeverApproved(entry)) return VRF_PREVIEW_MARK;
    return VRF_ORIGINAL_MARK;
  }
  if (edition === "liquidated") {
    if (block && block.print && block.previewMark) return block.previewMark;
    const st = String(entry && entry.status || "");
    if (/^not bought$/i.test(st)) return "NOT BOUGHT";
    if (/^duplicate/i.test(st)) return "DUPLICATE";
    if (/^cancel/i.test(st)) return "CANCELLED";
    return VRF_LIQUIDATED_MARK;
  }
  return "";
}

function vrfIsLiquidated(entry) {
  if (!entry) return false;
  const st = String(entry.status || "").trim();
  if (st === "Closed" || st === "Flagged" || st === "Not bought" || st === "Cancelled" || st === "Duplicate") {
    return true;
  }
  if (/^liquidated$/i.test(st)) return true;
  if (entry.liq) return true;
  return (entry.rows || []).some(function (r) {
    return r && r.liq;
  });
}

/**
 * Read-only list of liquidated VRFs whose peso variance is above 50%.
 * vrfs: [{ vrf, status, rows, reserve }]
 */
function liquidationVarianceReport(spec) {
  spec = spec || {};
  const issued = spec.issued || { numbers: {} };
  const reserves = spec.reserves || [];
  const byNo = {};
  reserves.forEach(function (r) {
    if (r && r.no != null) byNo[String(r.no)] = r;
  });
  const out = [];
  (spec.vrfs || []).forEach(function (v) {
    if (!vrfIsLiquidated(v)) return;
    const reserve = v.reserveNo != null ? byNo[String(v.reserveNo)] : v.reserve && byNo[String(v.reserve)];
    const linked = reserve || null;
    const approved = originalApprovedSource(v.vrf, issued, linked);
    const variance = liquidatedVariance(v.rows || [], approved, linked);
    if (!variance.overPrintMax) return;
    out.push({
      vrf: String(v.vrf || ""),
      reserve: linked ? String(linked.no) : String(v.reserve || v.reserveNo || ""),
      status: String(v.status || ""),
      approved: variance.approved,
      actual: variance.actual,
      pct: variance.pct,
      pctLabel: formatVariancePct(variance.pct),
      source: variance.source,
      label: variance.label,
      varianceApprovedBy: linked ? linked.varianceApprovedBy || "" : "",
      varianceApprovedAt: linked ? linked.varianceApprovedAt || "" : "",
      printBlocked: variance.printBlocked,
    });
  });
  out.sort(function (a, b) {
    return b.pct - a.pct;
  });
  return {
    threshold: VARIANCE_PRINT_MAX,
    count: out.length,
    rows: out,
  };
}

function applyVarianceApproval(reserve, by, at, note, pctLabel) {
  if (!reserve) return false;
  const who = String(by || "").trim();
  if (!who) return false;
  reserve.varianceApprovedBy = who;
  reserve.varianceApprovedAt = at || "";
  reserve.varianceApprovedNote = String(note || "").trim();
  reserve.audit = (reserve.audit || []).concat([
    {
      at: reserve.varianceApprovedAt,
      by: who,
      field: "variance-approval",
      from: pctLabel || "",
      to: "approved",
      note: reserve.varianceApprovedNote,
    },
  ]);
  return true;
}

function clearVarianceApproval(reserve) {
  if (!reserve) return;
  reserve.varianceApprovedBy = "";
  reserve.varianceApprovedAt = "";
  reserve.varianceApprovedNote = "";
}

var MotorpoolLiquidation = {
  VARIANCE_TOL_DEFAULT: VARIANCE_TOL_DEFAULT,
  VARIANCE_PRINT_MAX: VARIANCE_PRINT_MAX,
  VRF_PREVIEW_MARK: VRF_PREVIEW_MARK,
  VRF_VARIANCE_PREVIEW_MARK: VRF_VARIANCE_PREVIEW_MARK,
  VRF_PROOF_PREVIEW_MARK: VRF_PROOF_PREVIEW_MARK,
  VRF_ORIGINAL_MARK: VRF_ORIGINAL_MARK,
  VRF_LIQUIDATED_MARK: VRF_LIQUIDATED_MARK,
  APPROVED_BUDGET_LABEL: APPROVED_BUDGET_LABEL,
  moneyNum: moneyNum,
  lineMoney: lineMoney,
  fuelLitresOf: fuelLitresOf,
  sumLineMoney: sumLineMoney,
  sumFuelLitres: sumFuelLitres,
  formatVariancePct: formatVariancePct,
  varianceOverrun: varianceOverrun,
  variancePrintBlocked: variancePrintBlocked,
  variancePrintMessage: variancePrintMessage,
  latestVrfSeal: latestVrfSeal,
  originalApprovedSource: originalApprovedSource,
  fuelLiterNotice: fuelLiterNotice,
  changeOwedAmount: changeOwedAmount,
  varianceApprovalOn: varianceApprovalOn,
  liquidatedVariance: liquidatedVariance,
  vrfIsFuelReserveDraw: vrfIsFuelReserveDraw,
  liquidationProofGate: liquidationProofGate,
  liquidatedPrintBlock: liquidatedPrintBlock,
  vrfWasNeverApproved: vrfWasNeverApproved,
  editionStamp: editionStamp,
  vrfIsLiquidated: vrfIsLiquidated,
  liquidationVarianceReport: liquidationVarianceReport,
  applyVarianceApproval: applyVarianceApproval,
  clearVarianceApproval: clearVarianceApproval,
};

var liquidationRoot = typeof globalThis !== "undefined" ? globalThis : this;
liquidationRoot.MotorpoolLiquidation = MotorpoolLiquidation;
if (typeof module === "object" && module.exports) module.exports = MotorpoolLiquidation;
