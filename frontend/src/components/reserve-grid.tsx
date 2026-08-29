"use client";

import { ASSETS } from "@/config/assets";
import { ReserveCard } from "@/components/reserve/reserve-card";
import { ReserveRealEstateCard } from "@/components/reserve/reserve-real-estate-card";

const NON_REAL_ESTATE_ASSETS = ASSETS.filter((asset) => asset.kind !== "real-estate");
const REAL_ESTATE_TIERS = ASSETS.filter((asset) => asset.kind === "real-estate");

export function ReserveGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {NON_REAL_ESTATE_ASSETS.map((asset, index) => (
        <ReserveCard key={asset.id} asset={asset} index={index} />
      ))}
      {REAL_ESTATE_TIERS.length > 0 && (
        <ReserveRealEstateCard
          title="Paris Property #01"
          tiers={REAL_ESTATE_TIERS}
          index={NON_REAL_ESTATE_ASSETS.length}
        />
      )}
    </div>
  );
}
