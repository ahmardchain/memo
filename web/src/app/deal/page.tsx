import { Suspense } from "react";
import { DealView } from "@/components/DealView";

export default function DealPage() {
  return (
    <Suspense fallback={<p className="muted">Loading deal…</p>}>
      <DealView />
    </Suspense>
  );
}
