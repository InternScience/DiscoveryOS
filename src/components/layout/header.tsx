"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bot, Settings, Zap, FolderOpen, Minimize2, Database, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { LanguageToggle } from "./language-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEffect, useState, useCallback } from "react";

interface HeaderProps {
  onToggleMinimalMode?: () => void;
  showMinimalToggle?: boolean;
}

/** Returns true when running inside the Tauri webview. */
function useTauri() {
  const [isTauri, setIsTauri] = useState(false);
  useEffect(() => {
    setIsTauri(typeof window !== "undefined" && "__TAURI__" in window);
  }, []);
  return isTauri;
}

export function Header({ onToggleMinimalMode, showMinimalToggle }: HeaderProps) {
  const t = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const isTauri = useTauri();
  const [isMaximized, setIsMaximized] = useState(false);

  // Keep maximize state in sync
  useEffect(() => {
    if (!isTauri) return;
    let cleanup: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      setIsMaximized(await win.isMaximized());
      const unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
      });
      cleanup = unlisten;
    })();
    return () => cleanup?.();
  }, [isTauri]);

  const minimize = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  }, []);

  const toggleMaximize = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    isMaximized ? await win.unmaximize() : await win.maximize();
  }, [isMaximized]);

  const close = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }, []);

  // Extract workspaceId from URL like /workspace/xxx
  const workspaceMatch = pathname.match(/^\/workspace\/([^/]+)/);
  const workspaceId = workspaceMatch?.[1] ?? null;

  return (
    <TooltipProvider delayDuration={300}>
      {/* data-tauri-drag-region makes the entire header draggable in frameless mode */}
      <header
        data-tauri-drag-region
        className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 select-none"
      >
        <div className="flex h-12 w-full items-center px-3">
          {/* Logo — click area must not be drag region */}
          <Link
            href="/"
            className="group flex items-center gap-2 font-semibold shrink-0"
            data-tauri-drag-region="false"
          >
            <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 transition-all duration-300 group-hover:from-primary/30 group-hover:to-accent/30">
              <Bot className="h-4 w-4 text-primary transition-transform duration-300 group-hover:scale-110" />
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-primary to-accent opacity-0 blur-lg transition-opacity duration-300 group-hover:opacity-30" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-sm text-transparent transition-all duration-300 group-hover:from-primary group-hover:to-accent">
              DiscoveryOS
            </span>
          </Link>

          {/* Drag area spacer */}
          <div className="flex-1" data-tauri-drag-region />

          {/* Navigation — pointer events override drag region */}
          <nav className="flex items-center gap-1" data-tauri-drag-region="false">
            {showMinimalToggle && onToggleMinimalMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg transition-all duration-200 hover:bg-primary/10 hover:text-primary"
                    onClick={onToggleMinimalMode}
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("minimalMode")}</TooltipContent>
              </Tooltip>
            )}

            {workspaceId && pathname !== `/workspace/${workspaceId}` && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href={`/workspace/${workspaceId}`}>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg transition-all duration-200 hover:bg-primary/10 hover:text-primary">
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("workspace")}</TooltipContent>
              </Tooltip>
            )}

            <LanguageToggle />
            <ThemeToggle />

            <div className="mx-1 h-4 w-px bg-border/50" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/datasets">
                  <Button variant="ghost" size="icon" className={`h-8 w-8 rounded-lg transition-all duration-200 hover:bg-primary/10 hover:text-primary ${pathname === "/datasets" ? "bg-primary/10 text-primary" : ""}`}>
                    <Database className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("datasets")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/skills">
                  <Button variant="ghost" size="icon" className={`h-8 w-8 rounded-lg transition-all duration-200 hover:bg-accent/10 hover:text-accent ${pathname === "/skills" ? "bg-accent/10 text-accent" : ""}`}>
                    <Zap className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("skills")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                {pathname === "/settings" ? (
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg bg-primary/10 text-primary" onClick={() => router.back()}>
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Link href="/settings">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg transition-all duration-200 hover:bg-muted hover:text-foreground">
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("settings")}</TooltipContent>
            </Tooltip>

            {/* Custom window controls — only in Tauri desktop */}
            {isTauri && (
              <>
                <div className="mx-1.5 h-4 w-px bg-border/50" />
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={minimize}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Minimize"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <button
                    onClick={toggleMaximize}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title={isMaximized ? "Restore" : "Maximize"}
                  >
                    <Square className="h-3 w-3" />
                  </button>
                  <button
                    onClick={close}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
                    title="Close"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </>
            )}
          </nav>
        </div>
      </header>
    </TooltipProvider>
  );
}
