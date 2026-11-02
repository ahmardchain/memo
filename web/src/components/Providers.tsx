"use client";

import { NearProvider } from "@/lib/near";
import { ToastProvider } from "./Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NearProvider>
      <ToastProvider>{children}</ToastProvider>
    </NearProvider>
  );
}
