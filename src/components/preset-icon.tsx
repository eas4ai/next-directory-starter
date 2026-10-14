"use client";

import { ArrowUpRight } from "lucide-react";
import { IconArrowUpRight } from "@tabler/icons-react";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { RiArrowRightUpLine } from "@remixicon/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

export function PresetExternalLinkIcon({ library }: { library: string }) {
  const common = { size: 16, "aria-hidden": true as const };
  let icon;
  switch (library) {
    case "hugeicons": icon = <HugeiconsIcon icon={ArrowUpRight01Icon} {...common} strokeWidth={1.5} />; break;
    case "tabler": icon = <IconArrowUpRight {...common} />; break;
    case "phosphor": icon = <ArrowUpRightIcon {...common} />; break;
    case "remixicon": icon = <RiArrowRightUpLine {...common} />; break;
    default: icon = <ArrowUpRight {...common} />;
  }
  return <span data-icon-library={library} className="inline-flex shrink-0 items-center">{icon}</span>;
}
