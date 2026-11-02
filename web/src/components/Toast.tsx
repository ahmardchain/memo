"use client";

import { createContext, useCallback, useContext, useState } from "react";

const Ctx = createContext<(msg: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3500);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
