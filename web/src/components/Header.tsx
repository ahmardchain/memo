"use client";

import Link from "next/link";
import { useNear } from "@/lib/near";
import { NETWORK } from "@/config";
import { shortAccount } from "@/lib/format";

export function Header() {
  const { accountId, signIn, signOut, ready } = useNear();
  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">m</span> memo
          {NETWORK === "testnet" && <span className="net">testnet</span>}
        </Link>
        <nav className="nav">
          <Link href="/create/" className="btn btn-sm">New deal</Link>
          {accountId ? (
            <button className="btn btn-sm" onClick={signOut} title="Sign out">
              {shortAccount(accountId)}
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={signIn} disabled={!ready}>
              Connect wallet
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
