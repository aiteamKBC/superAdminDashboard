import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { GraduationCap, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

const microsoftClientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID || "";
const microsoftTenantId = import.meta.env.VITE_MICROSOFT_TENANT_ID || "organizations";
const microsoftRedirectUri =
  import.meta.env.VITE_MICROSOFT_REDIRECT_URI ||
  (typeof window !== "undefined" ? `${window.location.origin}/login` : "");
const microsoftScope = "openid profile email User.Read";

const base64UrlEncode = (input: ArrayBuffer) => {
  const bytes = new Uint8Array(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const createPkcePair = async () => {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes.buffer);
  const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return {
    verifier,
    challenge: base64UrlEncode(challengeBytes),
  };
};

const randomState = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
};

export default function LoginPage() {
  const { user, loading, login, loginWithMicrosoftToken } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [error, setError] = useState("");

  const from = useMemo(() => {
    const stateFrom = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    return stateFrom && stateFrom !== "/login" ? stateFrom : "/";
  }, [location.state]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const authError = params.get("error_description") || params.get("error");

    if (authError) {
      setError(authError);
      window.history.replaceState({}, document.title, "/login");
      return;
    }

    if (!code) return;

    let cancelled = false;

    const completeMicrosoftLogin = async () => {
      try {
        setMicrosoftLoading(true);
        setError("");

        const expectedState = sessionStorage.getItem("kbc-ms-state");
        const verifier = sessionStorage.getItem("kbc-ms-verifier");
        const returnTo = sessionStorage.getItem("kbc-auth-return-to") || "/";

        if (!expectedState || expectedState !== returnedState || !verifier) {
          throw new Error("Microsoft sign-in state could not be verified. Please try again.");
        }

        const tokenRes = await fetch(`https://login.microsoftonline.com/${microsoftTenantId}/oauth2/v2.0/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: microsoftClientId,
            scope: microsoftScope,
            code,
            redirect_uri: microsoftRedirectUri,
            grant_type: "authorization_code",
            code_verifier: verifier,
          }),
        });

        const tokenPayload = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenPayload.access_token) {
          throw new Error(tokenPayload.error_description || "Microsoft token exchange failed.");
        }

        await loginWithMicrosoftToken(tokenPayload.access_token);

        sessionStorage.removeItem("kbc-ms-state");
        sessionStorage.removeItem("kbc-ms-verifier");
        sessionStorage.removeItem("kbc-auth-return-to");

        if (!cancelled) navigate(returnTo, { replace: true });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Microsoft sign-in failed.");
          window.history.replaceState({}, document.title, "/login");
        }
      } finally {
        if (!cancelled) setMicrosoftLoading(false);
      }
    };

    completeMicrosoftLogin();

    return () => {
      cancelled = true;
    };
  }, [loginWithMicrosoftToken, navigate]);

  const handlePasswordLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setError("Enter your username/email and password.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      await login(identifier.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    try {
      setMicrosoftLoading(true);
      setError("");

      if (!microsoftClientId) {
        throw new Error("Microsoft login needs VITE_MICROSOFT_CLIENT_ID in frontend/.env.");
      }

      const { verifier, challenge } = await createPkcePair();
      const state = randomState();

      sessionStorage.setItem("kbc-ms-state", state);
      sessionStorage.setItem("kbc-ms-verifier", verifier);
      sessionStorage.setItem("kbc-auth-return-to", from);

      const authorizeUrl = new URL(`https://login.microsoftonline.com/${microsoftTenantId}/oauth2/v2.0/authorize`);
      authorizeUrl.searchParams.set("client_id", microsoftClientId);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("redirect_uri", microsoftRedirectUri);
      authorizeUrl.searchParams.set("response_mode", "query");
      authorizeUrl.searchParams.set("scope", microsoftScope);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", challenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");

      window.location.assign(authorizeUrl.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microsoft sign-in could not start.");
      setMicrosoftLoading(false);
    }
  };

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#F4F8FC_0%,#EEF7FF_48%,#E8F1FA_100%)] p-4">
      <Card className="grid w-full max-w-[920px] overflow-hidden rounded-2xl border-[#DDE7F0] bg-white shadow-[0_24px_80px_rgba(20,38,74,0.16)] md:grid-cols-[1fr_1.08fr]">
        <section className="relative hidden min-h-[560px] flex-col justify-between bg-gradient-to-b from-[#14264A] via-[#184D91] to-[#1E6ACB] p-8 text-white md:flex">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_12%,rgba(255,255,255,0.22),transparent_28%),linear-gradient(135deg,rgba(28,155,122,0.22),transparent_44%)]" />
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/14 ring-1 ring-white/24">
              <GraduationCap className="h-7 w-7" />
            </div>
            <h1 className="mt-6 text-3xl font-bold leading-tight">Kent Business College</h1>
            <p className="mt-2 max-w-[280px] text-sm font-medium text-[#D7EAFB]">
              Engagement workspace for learner risk, reviews, and actions.
            </p>
          </div>

          <div className="relative rounded-2xl border border-white/18 bg-white/10 p-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[#BFEDE4]" />
              <div>
                <p className="text-sm font-bold">KBC authenticated access</p>
                <p className="mt-0.5 text-xs text-white/72">Accounts are checked against auth_user.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="p-6 sm:p-9">
          <div className="mx-auto max-w-[410px]">
            <div className="mb-7 flex items-center gap-3 md:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#184D91] text-white">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-[#14264A]">Kent Business College</p>
                <p className="text-xs text-[#71849A]">Engagement Workspace</p>
              </div>
            </div>

            <div className="mb-7">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#1E6ACB]">Sign in</p>
              <h2 className="mt-2 text-2xl font-bold text-[#14264A]">Access your dashboard</h2>
              <p className="mt-2 text-sm text-[#5F7288]">
                Use your KBC Microsoft email or your existing dashboard account.
              </p>
            </div>

            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier">Username or Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7EA6CF]" />
                  <Input
                    id="identifier"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    className="h-12 rounded-xl border-[#DDE7F0] bg-[#F8FBFE] pl-10 text-[#20344D] placeholder:text-[#8AA0B6] focus-visible:ring-[#1E6ACB]"
                    placeholder="Enter your username or email"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7EA6CF]" />
                  <Input
                    id="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 rounded-xl border-[#DDE7F0] bg-[#F8FBFE] pl-10 text-[#20344D] placeholder:text-[#8AA0B6] focus-visible:ring-[#1E6ACB]"
                    placeholder="Enter your password"
                    type="password"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                className="h-12 w-full rounded-xl bg-[#14264A] text-base font-bold text-white hover:bg-[#184D91]"
                disabled={submitting || microsoftLoading}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Sign in
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-[#DDE7F0]" />
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71849A]">or</span>
              <div className="h-px flex-1 bg-[#DDE7F0]" />
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-xl border-[#B8D7F2] bg-white text-sm font-bold text-[#14264A] hover:bg-[#EEF7FF]"
              onClick={handleMicrosoftLogin}
              disabled={submitting || microsoftLoading}
            >
              {microsoftLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="grid h-5 w-5 grid-cols-2 gap-0.5">
                  <span className="rounded-[1px] bg-[#F25022]" />
                  <span className="rounded-[1px] bg-[#7FBA00]" />
                  <span className="rounded-[1px] bg-[#00A4EF]" />
                  <span className="rounded-[1px] bg-[#FFB900]" />
                </span>
              )}
              Continue with Microsoft Teams
            </Button>

            <p className="mt-5 text-center text-xs text-[#71849A]">
              Microsoft sign-in only opens accounts already registered in KBC auth_user.
            </p>
          </div>
        </section>
      </Card>
    </main>
  );
}
