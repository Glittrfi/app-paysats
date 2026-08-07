"use client";

import { fetchWithPrivy } from "@/lib/api";
import { useCurrency, type CurrencyCode } from "@/lib/currency";
import { useT } from "@/lib/i18n";
import { usePostLoginSync } from "@/hooks/use-post-login-sync";
import { useLogin, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { OnbCreating } from "./onb-creating";
import { OnbCurrency } from "./onb-currency";
import { OnbHook } from "./onb-hook";
import { Splash } from "./splash";

type Step = "splash" | "hook" | "creating" | "currency";

/**
 * Full onboarding flow:
 *   splash → hook (google or email) → creating (post-login sync) → currency → /home
 *
 * Handles users landing here both before and after Privy auth. If a returning
 * user has already completed onboarding we immediately bounce them to /home.
 */
export function OnboardingClient() {
  const router = useRouter();
  const t = useT();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { initOAuth, state } = useLoginWithOAuth();
  const sync = usePostLoginSync();
  const { setCurrency } = useCurrency();

  const [step, setStep] = useState<Step>("splash");
  const [fade, setFade] = useState(true);
  const [syncDone, setSyncDone] = useState(false);
  const [needsCurrency, setNeedsCurrency] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef(getAccessToken);
  const syncRef = useRef(sync);
  useLayoutEffect(() => {
    tokenRef.current = getAccessToken;
    syncRef.current = sync;
  }, [getAccessToken, sync]);

  const go = useCallback((next: Step) => {
    setFade(false);
    window.setTimeout(() => {
      setStep(next);
      setFade(true);
    }, 200);
  }, []);

  const goRef = useRef(go);
  useLayoutEffect(() => {
    goRef.current = go;
  }, [go]);

  const { login } = useLogin({
    onComplete: () => {
      goRef.current("creating");
    },
    onError: () => {
      setError(t("auth.loginFailed"));
    },
  });

  // Step 0 → decide where to go once Privy is ready
  useEffect(() => {
    if (step !== "splash") return;
    if (!ready) return;
    const t = window.setTimeout(() => {
      if (authenticated) {
        go("creating");
      } else {
        go("hook");
      }
    }, 1800);
    return () => window.clearTimeout(t);
  }, [ready, authenticated, step, go]);

  // Email (or any) login that authenticates while still on the hook screen.
  useEffect(() => {
    if (step === "hook" && authenticated) {
      go("creating");
    }
  }, [step, authenticated, go]);

  // Once authenticated, run post-login sync + check user/me for currency state
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        await syncRef.current();
        const res = await fetchWithPrivy(
          tokenRef.current,
          "/api/user/me",
        );
        const j = (await res.json().catch(() => ({}))) as {
          currencyPreference?: string | null;
          onboardingCompleted?: boolean;
        };
        if (cancelled) return;
        setNeedsCurrency(
          !j.currencyPreference || !j.onboardingCompleted,
        );
        setSyncDone(true);
      } catch (e) {
        console.error("Post-login setup failed:", e);
        if (cancelled) return;
        setSyncDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  // Translate Privy OAuth status into UI
  const oauthLoading = state.status === "loading";
  const oauthError =
    state.status === "error" ? t("auth.loginFailed") : null;

  const onContinueGoogle = useCallback(async () => {
    setError(null);
    try {
      await initOAuth({ provider: "google" });
      go("creating");
    } catch (e) {
      console.error(e);
      setError(t("auth.loginFailed"));
    }
  }, [initOAuth, go, t]);

  const onContinueEmail = useCallback(() => {
    setError(null);
    login({ loginMethods: ["email"] });
  }, [login]);

  const onCreatingDone = useCallback(() => {
    if (needsCurrency) {
      go("currency");
    } else {
      router.replace("/home");
    }
  }, [needsCurrency, go, router]);

  const onCurrencyContinue = useCallback(
    async (c: CurrencyCode) => {
      setBusy(true);
      setCurrency(c);
      try {
        await fetchWithPrivy(tokenRef.current, "/api/user/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currencyPreference: c,
            completeOnboarding: true,
          }),
        });
      } catch (e) {
        console.error("Failed to persist currency preference:", e);
      }
      router.replace("/home");
    },
    [setCurrency, router],
  );

  return (
    <div
      className="absolute inset-0 transition-opacity duration-200"
      style={{ opacity: fade ? 1 : 0 }}
    >
      {step === "splash" ? <Splash /> : null}
      {step === "hook" ? (
        <OnbHook
          onContinueGoogle={onContinueGoogle}
          onContinueEmail={onContinueEmail}
          loading={oauthLoading}
          errorText={error ?? oauthError}
        />
      ) : null}
      {step === "creating" ? (
        <OnbCreating ready={syncDone} onDone={onCreatingDone} />
      ) : null}
      {step === "currency" ? (
        <OnbCurrency onContinue={onCurrencyContinue} busy={busy} />
      ) : null}
    </div>
  );
}
