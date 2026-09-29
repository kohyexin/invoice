"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { AppBackdrop } from "@/components/shell/app-backdrop";
import { BrandLogo } from "@/components/shell/brand-logo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      window.location.href = "/dashboard";
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Sign-in failed.");
    setLoading(false);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <AppBackdrop />
      <form
        onSubmit={submit}
        className="glass-panel neon-edge relative z-10 w-full max-w-sm rounded-card p-7 animate-scale-in"
      >
        <BrandLogo />
        <h1 className="mt-7 text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-muted">Invoices, clients and payments.</p>

        {error && (
          <p className="mt-5 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-200">
            {error}
          </p>
        )}

        <div className="mt-5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="mt-4">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-control text-ink-soft hover:text-ink"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" className="mt-6 w-full" loading={loading}>
          <Lock className="h-4 w-4" />
          Sign in
        </Button>
      </form>
    </div>
  );
}
