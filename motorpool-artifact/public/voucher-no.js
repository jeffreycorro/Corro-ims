/**
 * Optional liquidation voucher number.
 * One field covers a petty cash voucher (PC / PCV), a GCash voucher, or a
 * check voucher (DV / CV / bank check number). The value is kept as entered.
 * voucherKey is the match form: trimmed, uppercased, spaces removed.
 * Loaded by the Motorpool page and required by the voucher-match function.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VoucherNo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function hintOf(key) {
    if (!key) return "";
    if (/^PCV?\d{4}-/.test(key) || /^PCV-/.test(key)) return "petty";
    if (/^PC\d{4}-/.test(key)) return "petty";
    if (/GCASH/.test(key) || /^GC\d{4}-/.test(key)) return "gcash";
    if (/^DV\d{4}-/.test(key) || /^CV[\d-]/.test(key)) return "check";
    if (/^(BPI|BDO|AUB|PBB|RCBC|DBP|LBP|PNB)\d{4}-/.test(key)) return "check";
    return "";
  }

  function normalize(raw) {
    var text = String(raw == null ? "" : raw).trim();
    if (!text) return { voucherNo: "", voucherKey: "", hint: "" };
    var key = text.toUpperCase().replace(/\s+/g, "");
    return { voucherNo: text, voucherKey: key, hint: hintOf(key) };
  }

  /** Exact keys to try against Finance. PCV2026-0007 also tries PC2026-0007. */
  function lookupKeys(norm) {
    var key = norm && norm.voucherKey;
    if (!key) return [];
    var keys = [key];
    var prefixed = /^PCV(\d{4}-.+)$/.exec(key);
    if (prefixed) keys.push("PC" + prefixed[1]);
    return keys;
  }

  function hintText(hint) {
    if (hint === "petty") return "Looks like a petty cash voucher.";
    if (hint === "gcash") return "Looks like a GCash voucher.";
    if (hint === "check") return "Looks like a check voucher.";
    return "";
  }

  return { normalize: normalize, lookupKeys: lookupKeys, hintText: hintText, hintOf: hintOf };
});
