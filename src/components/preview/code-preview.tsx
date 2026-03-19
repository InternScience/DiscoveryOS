"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import hljs from "highlight.js/lib/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, Pencil, Save, Copy, CheckCheck } from "lucide-react";
import { useFileContent } from "@/lib/hooks/use-file-content";
import { toast } from "sonner";

// Register languages selectively to keep bundle small
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import sql from "highlight.js/lib/languages/sql";
import kotlin from "highlight.js/lib/languages/kotlin";
import swift from "highlight.js/lib/languages/swift";
import scala from "highlight.js/lib/languages/scala";
import lua from "highlight.js/lib/languages/lua";
import perl from "highlight.js/lib/languages/perl";
import r from "highlight.js/lib/languages/r";
import dart from "highlight.js/lib/languages/dart";
import groovy from "highlight.js/lib/languages/groovy";
import ini from "highlight.js/lib/languages/ini";
import makefile from "highlight.js/lib/languages/makefile";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import graphql from "highlight.js/lib/languages/graphql";
import scss from "highlight.js/lib/languages/scss";
import less from "highlight.js/lib/languages/less";
import protobuf from "highlight.js/lib/languages/protobuf";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("java", java);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("perl", perl);
hljs.registerLanguage("r", r);
hljs.registerLanguage("dart", dart);
hljs.registerLanguage("groovy", groovy);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("graphql", graphql);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("less", less);
hljs.registerLanguage("protobuf", protobuf);

/** Map file extension to highlight.js language name */
const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  json: "json",
  html: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bat: "bash",
  java: "java",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  sql: "sql",
  kt: "kotlin",
  swift: "swift",
  scala: "scala",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  dart: "dart",
  groovy: "groovy",
  toml: "ini",
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmake: "makefile",
  graphql: "graphql",
  proto: "protobuf",
};

function getLanguage(filePath: string): string | undefined {
  const filename = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (filename === "dockerfile") return "dockerfile";
  if (filename === "makefile") return "makefile";
  const ext = filename.split(".").pop() ?? "";
  return EXT_TO_LANG[ext];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function CodePreview({ filePath }: { filePath: string }) {
  const t = useTranslations("preview");
  const tCommon = useTranslations("common");
  const tFiles = useTranslations("files");
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const { content, loading, saving, modified, handleSave, updateContent } =
    useFileContent({
      filePath,
      onLoad: () => setViewMode("preview"),
    });

  const language = useMemo(() => getLanguage(filePath), [filePath]);

  const highlightedHtml = useMemo(() => {
    if (!content) return "";
    if (language) {
      try {
        return hljs.highlight(content, { language }).value;
      } catch {
        // fallback below
      }
    }
    try {
      return hljs.highlightAuto(content).value;
    } catch {
      return escapeHtml(content);
    }
  }, [content, language]);

  const lineCount = useMemo(() => (content || "").split("\n").length, [content]);

  const onSave = async () => {
    const ok = await handleSave();
    if (ok) toast.success(tFiles("saved"));
  };

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [content]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {tCommon("loading")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          {language && (
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {language}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {lineCount} lines
          </span>
        </div>
        <div className="flex items-center gap-2">
          {modified && (
            <span className="text-xs text-muted-foreground">{tCommon("modified")}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 w-7 p-0"
            title="Copy"
          >
            {copied ? (
              <CheckCheck className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant={viewMode === "preview" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("preview")}
              title={t("previewMode")}
            >
              <Eye className="mr-1 h-3.5 w-3.5" />
              {t("previewMode")}
            </Button>
            <Button
              variant={viewMode === "edit" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("edit")}
              title={t("editMode")}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t("editMode")}
            </Button>
          </div>
          {viewMode === "edit" && (
            <Button size="sm" onClick={onSave} disabled={saving || !modified}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? tFiles("saving") : tCommon("save")}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {viewMode === "preview" ? (
        <ScrollArea className="flex-1">
          <div className="code-preview-container flex">
            {/* Line numbers gutter */}
            <div
              className="code-line-numbers select-none border-r border-border/50 pr-3 text-right font-mono text-muted-foreground/50"
              aria-hidden="true"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i + 1}>{i + 1}</div>
              ))}
            </div>
            {/* Highlighted code */}
            <pre className="flex-1 overflow-x-auto pl-4 m-0 bg-transparent">
              <code
                className={`hljs${language ? ` language-${language}` : ""}`}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </pre>
          </div>
        </ScrollArea>
      ) : (
        <div className="flex flex-1 flex-col gap-2 px-3 pb-3">
          <Textarea
            className="flex-1 resize-none font-mono text-sm"
            value={content}
            onChange={(e) => updateContent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                onSave();
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
