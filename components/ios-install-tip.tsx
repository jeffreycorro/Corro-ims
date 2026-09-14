"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "ccd-a2hs-dismissed";

function shouldShowTip() {
  if (typeof window === "undefined") return false;
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone) return false;
    if (window.matchMedia("(display-mode: standalone)").matches) return false;
    if (window.localStorage.getItem(STORAGE_KEY) === "1") return false;
    const ua = window.navigator.userAgent || "";
    const iOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    if (!iOS) return false;
    return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  } catch {
    return false;
  }
}

export function IosInstallTip() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(shouldShowTip());
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex items-start gap-3 rounded-lg border border-navy-200 bg-white px-4 py-3 text-sm text-navy-900 shadow-lg"
      role="note"
    >
      <p className="min-w-0 flex-1 leading-snug">
        <strong className="mb-0.5 block text-xs font-semibold tracking-[0.14em] text-amber-600">
          ADD TO HOME SCREEN
        </strong>
        Safari → Share → Add to Home Screen. Opens as a full-screen CorConDev app.
      </p>
      <button
        type="button"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg text-navy-600"
        aria-label="Dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(STORAGE_KEY, "1");
          } catch {
            /* ignore quota / private mode */
          }
          setVisible(false);
        }}
      >
        ×
      </button>
    </div>
  );
}
