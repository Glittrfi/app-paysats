"use client";

import { usePostLoginSync } from "@/hooks/use-post-login-sync";
import { useT } from "@/lib/i18n";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

/** Routes that render chromeless (no bottom tab bar). */
const CHROMELESS_PREFIXES = [
  "/mint",
  "/withdraw",
  "/cash",
  "/profile",
  "/activity",
  "/offramp",
];

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-8.5Z"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SaveIcon({ active }: { active: boolean }) {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 7h9a5 5 0 0 1 5 5v5a2 2 0 0 1-2 2h-2v-2h-4v2H7a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinejoin="round"
      />
      <circle cx={15} cy={12.5} r={1} fill="currentColor" stroke="none" />
      <path
        d="M9 7V5a2 2 0 0 1 2-2h2"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function BorrowIcon({ active }: { active: boolean }) {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x={3.5}
        y={6.5}
        width={17}
        height={11}
        rx={2}
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <path
        d="M3.5 10.5h17"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <path
        d="M7 14.5h4"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ProductShell({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const pathname = usePathname();
  const router = useRouter();
  const sync = usePostLoginSync();
  const t = useT();

  const syncRef = useRef(sync);
  useLayoutEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      router.replace("/onboarding");
      return;
    }
    void syncRef.current();
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        style={{ background: "var(--paysats-bg)" }}
      >
        <div className="h-8 w-8 animate-pulse rounded-full bg-paysats-border" />
      </div>
    );
  }

  const nav: {
    href: string;
    label: string;
    Icon: (p: { active: boolean }) => React.ReactNode;
    match: (p: string) => boolean;
  }[] = [
    {
      href: "/home",
      label: t("nav.home"),
      Icon: HomeIcon,
      match: (p) => p === "/home" || p === "/",
    },
    {
      href: "/save",
      label: t("nav.save"),
      Icon: SaveIcon,
      match: (p) => p.startsWith("/save") || p.startsWith("/dca"),
    },
    {
      href: "/credit",
      label: t("nav.borrow"),
      Icon: BorrowIcon,
      match: (p) => p.startsWith("/credit") || p.startsWith("/borrow"),
    },
  ];

  const hideNav = CHROMELESS_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-1 flex-col bg-paysats-bg">
      <main
        key={pathname}
        className={`relative flex-1 animate-fade-rise ${hideNav ? "" : "pb-24"}`}
        style={{
          // Guarantee a stable top inset: respect the device safe area when
          // present, but never collapse below a small floor so the header
          // can't jam against the top edge on first paint.
          paddingTop: "max(env(safe-area-inset-top, 0px), 0.5rem)",
        }}
      >
        {children}
      </main>

      {hideNav ? null : (
        <nav
          className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t px-2 pb-2 pt-1.5"
          style={{
            background: "var(--paysats-surface)",
            borderColor: "var(--paysats-border)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
          }}
        >
          <div className="flex items-center justify-around">
            {nav.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-pressable
                  className="flex flex-1 flex-col items-center gap-0.5 rounded-[14px] px-3 py-1.5 transition-colors"
                  style={{
                    background: active
                      ? "var(--paysats-accent-soft)"
                      : "transparent",
                    color: active
                      ? "var(--paysats-accent)"
                      : "var(--paysats-text-faint)",
                  }}
                >
                  <span
                    style={{
                      filter: active
                        ? "drop-shadow(0 2px 4px rgba(184,92,56,0.25))"
                        : "none",
                    }}
                  >
                    <item.Icon active={active} />
                  </span>
                  <span
                    className="text-[10px]"
                    style={{ fontWeight: active ? 700 : 500 }}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
