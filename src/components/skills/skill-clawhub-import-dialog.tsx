"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle } from "lucide-react";
import { useWorkspaces } from "@/lib/hooks/use-workspaces";
import { parseClawHubUrl } from "@/lib/utils/clawhub";
import { toast } from "sonner";

interface SkillClawHubImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function SkillClawHubImportDialog({
  open,
  onOpenChange,
  onImported,
}: SkillClawHubImportDialogProps) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const { workspaces } = useWorkspaces();

  const [urlOrName, setUrlOrName] = useState("");
  const [slug, setSlug] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const displayPath = selectedWorkspace?.folderPath || "";

  const handleUrlChange = (value: string) => {
    setUrlOrName(value);
    setError(null);
    const parsed = parseClawHubUrl(value.trim());
    if (parsed) {
      setSlug(parsed.skillName);
    }
  };

  const resetState = () => {
    setUrlOrName("");
    setSlug("");
    setSelectedWorkspaceId(null);
    setImporting(false);
    setError(null);
  };

  const handleImport = async () => {
    if (!urlOrName.trim()) return;

    const parsed = parseClawHubUrl(urlOrName.trim());
    if (!parsed) {
      setError(t("clawHubInvalidUrl"));
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/skills/clawhub-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlOrName.trim(),
          slug: slug.trim() || undefined,
          workspaceId: selectedWorkspaceId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || t("clawHubFetchError"));
        return;
      }

      const result = await res.json();
      toast.success(t("clawHubImportSuccess", { name: result.name }));
      onImported();
      onOpenChange(false);
      resetState();
    } catch {
      setError(t("clawHubFetchError"));
    } finally {
      setImporting(false);
    }
  };

  const wsItemClass = (selected: boolean) =>
    `w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
      selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
    }`;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetState();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("clawHubImportTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Skill Name or URL */}
          <div className="space-y-1.5">
            <Label>{t("clawHubUrlLabel")}</Label>
            <Input
              value={urlOrName}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder={t("clawHubUrlPlaceholder")}
            />
          </div>

          {/* Target Folder Name (slug) */}
          <div className="space-y-1.5">
            <Label>{t("clawHubSlugLabel")}</Label>
            <Input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setError(null);
              }}
              placeholder={t("clawHubSlugPlaceholder")}
            />
          </div>

          {/* Import to Directory (workspace path display) */}
          <div className="space-y-1.5">
            <Label>{t("clawHubWorkspaceLabel")}</Label>
            <Input
              value={displayPath}
              readOnly
              placeholder={t("clawHubWorkspaceGlobal")}
              className="bg-muted/30"
            />
          </div>

          {/* Import note */}
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">
              {t("clawHubImportNote")}
            </p>
          </div>

          {/* Browse WORKSPACE_ROOTS */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("clawHubBrowseWorkspaces")}</Label>
            <ScrollArea className="h-[120px] rounded-md border">
              <div className="p-1">
                <button
                  type="button"
                  className={wsItemClass(selectedWorkspaceId === null)}
                  onClick={() => setSelectedWorkspaceId(null)}
                >
                  {t("clawHubWorkspaceGlobal")}
                </button>
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    className={wsItemClass(selectedWorkspaceId === ws.id)}
                    onClick={() => setSelectedWorkspaceId(ws.id)}
                  >
                    <span className="truncate block">{ws.folderPath}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* File browser area */}
          <div className="rounded-md border">
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              {t("clawHubFolderEmpty")}
            </div>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetState();
            }}
          >
            {tc("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleImport}
            disabled={importing || !urlOrName.trim()}
          >
            {importing ? t("importing") : t("import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
