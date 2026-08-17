"use client";

import { ASSETS } from "@/config/assets";
import { ReserveCard } from "@/components/reserve/reserve-card";

export function ReserveGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {ASSETS.map((asset, index) => (
        <ReserveCard key={asset.id} asset={asset} index={index} />
      ))}
    </div>
  );
}
