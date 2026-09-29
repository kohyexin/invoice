"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, fieldClass } from "@/components/ui/form-controls";
import { ROLE_HELP, ROLE_LABEL, type RoleName } from "@/lib/roles";
import { changeMyPassword, updateMyName } from "./actions";

function Message({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p
      className={
        tone === "error"
          ? "rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-200"
          : "rounded-control border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-200"
      }
    >
      {children}
    </p>
  );
}

function Card({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel neon-edge rounded-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Icon className="h-4 w-4 text-brand-300" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export function AccountView({ name, email, role }: { name: string; email: string; role: RoleName }) {
  const router = useRouter();
  const [draftName, setDraftName] = useState(name);
  const [profileMsg, setProfileMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [savingName, startName] = useTransition();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [savingPw, startPw] = useTransition();

  function saveName(e: React.FormEvent) {
    e.preventDefault();
    startName(async () => {
      const res = await updateMyName(draftName);
      setProfileMsg(res.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: res.error });
      if (res.ok) router.refresh();
    });
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setPwMsg({ tone: "error", text: "The new passwords don't match." });
      return;
    }
    startPw(async () => {
      const res = await changeMyPassword(current, next);
      if (!res.ok) {
        setPwMsg({ tone: "error", text: res.error });
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwMsg({ tone: "ok", text: "Password changed. Any other devices have been signed out." });
    });
  }

  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <Card icon={UserRound} title="Profile">
        <form onSubmit={saveName} className="space-y-4">
          {profileMsg && <Message tone={profileMsg.tone}>{profileMsg.text}</Message>}
          <Field label="Name" hint="Shown on invoices you create or change.">
            <input className={fieldClass} value={draftName} onChange={(e) => setDraftName(e.target.value)} required />
          </Field>
          <Field label="Email" hint="Ask an admin to change your sign-in email.">
            <input className={fieldClass} value={email} disabled />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink">Role</p>
            <div className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Badge tone="brand">{ROLE_LABEL[role]}</Badge>
              {ROLE_HELP[role]}
            </div>
          </div>
          <Button type="submit" size="sm" loading={savingName} disabled={draftName.trim() === name}>
            Save
          </Button>
        </form>
      </Card>

      <Card icon={KeyRound} title="Change password">
        <form onSubmit={savePassword} className="space-y-4">
          {pwMsg && <Message tone={pwMsg.tone}>{pwMsg.text}</Message>}
          <Field label="Current password">
            <input
              type="password"
              autoComplete="current-password"
              className={fieldClass}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            <input
              type="password"
              autoComplete="new-password"
              className={fieldClass}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={10}
              required
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              autoComplete="new-password"
              className={fieldClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" size="sm" loading={savingPw}>
            Change password
          </Button>
        </form>
      </Card>
    </div>
  );
}
