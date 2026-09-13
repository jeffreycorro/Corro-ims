/**
 * Host companion for the Claude Motorpool artifact.
 * Do not rewrite the artifact. The brief: prompt / confirm / alert / print
 * are blocked in the host and fail silently. The artifact already avoids
 * the first three; print still appears in a few leftover calls.
 */
(function () {
  "use strict";
  if (window.__mpHostBlocked) return;
  window.__mpHostBlocked = true;
  try {
    window.prompt = function () {
      return null;
    };
    window.confirm = function () {
      return false;
    };
    window.alert = function () {};
    window.print = function () {};
  } catch (e) {}
})();
