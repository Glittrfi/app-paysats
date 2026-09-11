"use client";

import { PreferenceHydrator } from "@/features/layout/preference-hydrator";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { I18nProvider } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";
import { DisplayUnitProvider } from "@/lib/display-unit";
import { base } from "viem/chains";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const stacksMcpOnly = process.env.NEXT_PUBLIC_MCP_PRODUCT === "stacks";
  if (stacksMcpOnly || !appId) {
    return (
      <I18nProvider>
        <CurrencyProvider>
          <DisplayUnitProvider>{children}</DisplayUnitProvider>
        </CurrencyProvider>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider>
      <CurrencyProvider>
        <DisplayUnitProvider>
          <PrivyProvider
            appId={appId}
            config={{
              loginMethods: ["google", "email"],
              appearance: {
                theme: "light",
                accentColor: "#b85c38",
              },
              defaultChain: base,
              supportedChains: [base],
              embeddedWallets: {
                ethereum: {
                  createOnLogin: "all-users",
                },
              },
            }}
          >
            <SmartWalletsProvider>
              <PreferenceHydrator />
              {children}
            </SmartWalletsProvider>
          </PrivyProvider>
        </DisplayUnitProvider>
      </CurrencyProvider>
    </I18nProvider>
  );
}
