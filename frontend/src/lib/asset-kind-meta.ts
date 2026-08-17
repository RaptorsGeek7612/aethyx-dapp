import { Coins, Building2 } from "lucide-react";
import type { AssetKind } from "@/config/assets";

export const KIND_META: Record<AssetKind, { icon: typeof Coins; gradient: string }> = {
  gold: { icon: Coins, gradient: "from-amber-400 to-amber-700" },
  silver: { icon: Coins, gradient: "from-slate-300 to-slate-500" },
  "real-estate": { icon: Building2, gradient: "from-sky-400 to-indigo-600" },
};
