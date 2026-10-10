"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { IDLE_MINUTES, IDLE_WARNING_SECONDS } from "@/lib/idle";

/** Last activity in any tab, so working in one tab keeps the others signed in too. */
const KEY = "backoffice:last-activity";
const IDLE_MS = IDLE_MINUTES * 60_000;
const WARN_MS = IDLE_WARNING_SECONDS * 1000;
/** How often activity is reported to the server, which keeps its own idle backstop. */
const PING_EVERY_MS = 60_000;
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

let lastPing = 0;
let signingOut = false;

const lastActivity = () => Number(localStorage.getItem(KEY)) || Date.now();
const markActive = () => localStorage.setItem(KEY, String(Date.now()));

async function expire() {
  if (signingOut) return;
  signingOut = true;
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.assign("/login?idle=1");
}

function ping(force = false) {
  const now = Date.now();
  if (!force && now - lastPing < PING_EVERY_MS) return;
  lastPing = now;
  fetch("/api/keepalive", { method: "POST", cache: "no-store" })
    .then((r) => {
      if (r.status === 401) void expire();
    })
    .catch(() => {});
}

/** Signs the user out after IDLE_MINUTES without activity, with a countdown
 *  warning first. Moving the mouse doesn't dismiss the warning; they choose. */
export function IdleTimeout() {
  const { t } = useI18n();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const warning = useRef(false);

  useEffect(() => {
    markActive();
    lastPing = Date.now();
    let lastWrite = 0;
    const onActivity = () => {
      if (warning.current) return;
      const now = Date.now();
      if (now - lastWrite < 1000) return;
      lastWrite = now;
      markActive();
      ping();
    };
    const tick = () => {
      const idle = Date.now() - lastActivity();
      if (idle >= IDLE_MS) return void expire();
      if (idle >= IDLE_MS - WARN_MS) {
        warning.current = true;
        setSecondsLeft(Math.ceil((IDLE_MS - idle) / 1000));
      } else if (warning.current) {
        warning.current = false;
        setSecondsLeft(null);
      }
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener("visibilitychange", tick);
    const timer = setInterval(tick, 1000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", tick);
      clearInterval(timer);
    };
  }, []);

  if (secondsLeft === null) return null;

  const stay = () => {
    markActive();
    warning.current = false;
    setSecondsLeft(null);
    ping(true);
  };
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-canvas/60 px-4 backdrop-blur-sm animate-fade-in">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-body"
        className="w-full max-w-sm rounded-card border border-overlay/10 bg-elevated p-6 text-center shadow-2xl"
      >
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-400/15 text-amber-600 dark:text-amber-300">
          <Clock className="h-5 w-5" />
        </div>
        <h2 id="idle-title" className="text-base font-semibold text-ink">
          {t("Are you still there?")}
        </h2>
        <p id="idle-body" className="mt-1.5 text-[13px] text-ink-muted">
          {t("For your security, you'll be signed out soon because you've been inactive.")}
        </p>
        <p className="tnum mt-4 font-mono text-3xl font-semibold text-ink" aria-live="polite">
          {countdown}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => void expire()}>
            {t("Sign out")}
          </Button>
          <Button onClick={stay} autoFocus>
            {t("Stay signed in")}
          </Button>
        </div>
      </div>
    </div>
  );
}
