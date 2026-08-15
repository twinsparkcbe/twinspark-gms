"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

export function DownloadXlsxButton({ onClick, disabled, label = "Download XLSX" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <Button type="button" variant="secondary" size="sm" className="rounded-[10px]" onClick={onClick} disabled={disabled}>
      <Download className="size-4" />
      {label}
    </Button>
  );
}
