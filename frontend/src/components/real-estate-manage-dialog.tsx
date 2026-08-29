"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { AssetActionForm } from "@/components/asset-action-dialog";
import type { AssetDefinition } from "@/config/assets";

/** The lock-up tier suffix after the em dash in a tier's title, e.g. "15-day lock" from
 *  "Paris Property #01 — 15-day lock" — see config/assets.ts's REAL_ESTATE_LOCKUP_TIERS. */
function tierLabel(asset: AssetDefinition) {
  return asset.title.split("—")[1]?.trim() ?? asset.title;
}

/**
 * Real estate has no per-deposit lock-up choice on-chain — RealEstateAdapter.lockupPeriod is
 * fixed per deployed market (see RealEstateAdapter.sol). Five separate markets exist instead, one
 * per tier; this dialog is the UI's stand-in for "pick a lock-up length", implemented as picking
 * which of those five markets to deposit into. Redeeming an existing position works the same way:
 * check the tier you already hold, and its own AssetActionForm shows your balance and lock state.
 */
export function RealEstateManageDialog({
  title,
  tiers,
  trigger,
}: {
  title: string;
  tiers: AssetDefinition[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<AssetDefinition["id"] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);

  const selected = tiers.find((tier) => tier.id === selectedId) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSelectedId(null);
          setPickerOpen(true);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="glass-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Fractionalized real estate. Choose a lock-up period to deposit into, or check the tier you already hold to
            redeem it.
          </DialogDescription>
        </DialogHeader>

        <Collapsible open={pickerOpen} onOpenChange={setPickerOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/5">
            <span>{selected ? `Lock-up: ${tierLabel(selected)}` : "Choose lock-up period"}</span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${pickerOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-1">
            {tiers.map((tier) => (
              <label
                key={tier.id}
                htmlFor={`tier-${tier.id}`}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/5"
              >
                <Checkbox
                  id={`tier-${tier.id}`}
                  checked={selectedId === tier.id}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedId(tier.id);
                      setPickerOpen(false);
                    }
                  }}
                />
                {tierLabel(tier)}
              </label>
            ))}
          </CollapsibleContent>
        </Collapsible>

        {selected && <AssetActionForm asset={selected} />}
      </DialogContent>
    </Dialog>
  );
}
