#!/usr/bin/env bash
# build-desktop.sh — Build DiscoveryOS as a distributable desktop application.
#
# Prerequisites: Rust (cargo), Node.js 24+, npm, curl, tar/unzip
#
# Usage:
#   ./scripts/build-desktop.sh                  # build for current platform
#   NODE_VERSION=v24.10.0 ./scripts/build-desktop.sh
#
# Output: tauri/src-tauri/target/release/bundle/
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/tauri/src-tauri"
BIN_DIR="$TAURI_DIR/binaries"
RES_DIR="$TAURI_DIR/resources/next-standalone"
NODE_VERSION="${NODE_VERSION:-v24.10.0}"

# ── detect platform ──────────────────────────────────────────────────────────

HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m)"

case "$HOST_OS" in
  Linux)
    case "$HOST_ARCH" in
      x86_64)  NODE_ARCH="x64";   RUST_TARGET="x86_64-unknown-linux-gnu"   ;;
      aarch64) NODE_ARCH="arm64"; RUST_TARGET="aarch64-unknown-linux-gnu"  ;;
      *)       echo "❌  Unsupported Linux arch: $HOST_ARCH" >&2; exit 1    ;;
    esac
    NODE_ARCHIVE="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
    NODE_INNER="bin/node"
    NODE_OUT="$BIN_DIR/node-${RUST_TARGET}"
    ;;
  Darwin)
    case "$HOST_ARCH" in
      x86_64)  NODE_ARCH="x64";   RUST_TARGET="x86_64-apple-darwin"        ;;
      arm64)   NODE_ARCH="arm64"; RUST_TARGET="aarch64-apple-darwin"        ;;
      *)       echo "❌  Unsupported macOS arch: $HOST_ARCH" >&2; exit 1    ;;
    esac
    NODE_ARCHIVE="node-${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
    NODE_INNER="bin/node"
    NODE_OUT="$BIN_DIR/node-${RUST_TARGET}"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    case "$HOST_ARCH" in
      x86_64|amd64) NODE_ARCH="x64";  RUST_TARGET="x86_64-pc-windows-msvc"  ;;
      aarch64)      NODE_ARCH="arm64"; RUST_TARGET="aarch64-pc-windows-msvc" ;;
      *)            echo "❌  Unsupported Windows arch: $HOST_ARCH" >&2; exit 1 ;;
    esac
    NODE_ARCHIVE="node-${NODE_VERSION}-win-${NODE_ARCH}.zip"
    NODE_INNER="node.exe"
    NODE_OUT="$BIN_DIR/node-${RUST_TARGET}.exe"
    ;;
  *)
    echo "❌  Unsupported OS: $HOST_OS" >&2
    exit 1
    ;;
esac

# Prefer the npmmirror CDN (fast in China); fall back to the official dist.
NODE_URL_MIRROR="https://npmmirror.com/mirrors/node/${NODE_VERSION}/${NODE_ARCHIVE}"
NODE_URL_OFFICIAL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}"

# ── step 1: download node binary ─────────────────────────────────────────────

mkdir -p "$BIN_DIR"

if [[ -f "$NODE_OUT" ]]; then
  echo "✅  Node binary already present: $NODE_OUT"
else
  echo "⬇️   Downloading Node.js ${NODE_VERSION} (${NODE_ARCH}) …"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  # Try mirror first, then official, with up to 3 retries each.
  _download_ok=0
  for _url in "$NODE_URL_MIRROR" "$NODE_URL_OFFICIAL"; do
    echo "    trying: $_url"
    if curl -fL --retry 3 --retry-delay 2 --progress-bar \
        "$_url" -o "$TMP_DIR/$NODE_ARCHIVE"; then
      _download_ok=1
      break
    fi
    echo "    ⚠️  failed, trying next source…"
    rm -f "$TMP_DIR/$NODE_ARCHIVE"
  done
  [[ $_download_ok -eq 1 ]] || { echo "❌  All download sources failed" >&2; exit 1; }

  echo "📦  Extracting …"
  case "$NODE_ARCHIVE" in
    *.tar.xz)
      tar -xJf "$TMP_DIR/$NODE_ARCHIVE" -C "$TMP_DIR"
      EXTRACTED="$(find "$TMP_DIR" -maxdepth 1 -type d -name "node-${NODE_VERSION}-*" | head -1)"
      cp "$EXTRACTED/$NODE_INNER" "$NODE_OUT"
      chmod +x "$NODE_OUT"
      ;;
    *.tar.gz)
      tar -xzf "$TMP_DIR/$NODE_ARCHIVE" -C "$TMP_DIR"
      EXTRACTED="$(find "$TMP_DIR" -maxdepth 1 -type d -name "node-${NODE_VERSION}-*" | head -1)"
      cp "$EXTRACTED/$NODE_INNER" "$NODE_OUT"
      chmod +x "$NODE_OUT"
      ;;
    *.zip)
      unzip -q "$TMP_DIR/$NODE_ARCHIVE" -d "$TMP_DIR"
      EXTRACTED="$(find "$TMP_DIR" -maxdepth 1 -type d -name "node-${NODE_VERSION}-*" | head -1)"
      cp "$EXTRACTED/$NODE_INNER" "$NODE_OUT"
      ;;
  esac
  echo "✅  Node binary saved: $NODE_OUT"
fi

# ── step 2: build Next.js standalone ─────────────────────────────────────────

echo ""
echo "🔨  Building Next.js (standalone output) …"
(
  cd "$ROOT_DIR"
  npm run build
)

STANDALONE_DIR="$ROOT_DIR/.next/standalone"
if [[ ! -f "$STANDALONE_DIR/server.js" ]]; then
  echo "❌  Next.js standalone output not found at $STANDALONE_DIR/server.js" >&2
  echo "    Make sure next.config.ts has  output: \"standalone\"" >&2
  exit 1
fi

# ── step 3: assemble resources for Tauri bundle ───────────────────────────────

echo ""
echo "📂  Assembling Tauri resources …"
rm -rf "$RES_DIR"
mkdir -p "$RES_DIR"

# Core standalone files
cp -R "$STANDALONE_DIR/." "$RES_DIR/"

# public/ (not copied by Next standalone)
if [[ -d "$ROOT_DIR/public" ]]; then
  rm -rf "$RES_DIR/public"
  cp -R "$ROOT_DIR/public" "$RES_DIR/public"
fi

# .next/static/ (not copied by Next standalone)
if [[ -d "$ROOT_DIR/.next/static" ]]; then
  mkdir -p "$RES_DIR/.next"
  rm -rf "$RES_DIR/.next/static"
  cp -R "$ROOT_DIR/.next/static" "$RES_DIR/.next/static"
fi

# Strip directories that Next.js NFT over-traces but are not needed at runtime.
# Next.js's outputFileTracingExcludes does not apply to instrumentation.js (it is
# a special server entry, not in entryNameFilesMap), so instrumentation.ts's
# process.cwd() call causes NFT to pull in the entire project root — including
# tauri/src-tauri/target/ (2.6 GB of Rust build artifacts).  We remove them here.
echo "🧹  Removing NFT-over-traced directories not needed at runtime …"
for _d in tauri src data docs scripts config site opensource drizzle; do
  if [[ -d "$RES_DIR/$_d" ]]; then
    rm -rf "$RES_DIR/$_d"
    echo "    removed: $_d"
  fi
done

# drizzle/ is removed above (NFT over-traces it from the project root), but the
# server needs it at runtime for database migrations.  Copy it from the project root.
if [[ -d "$ROOT_DIR/drizzle" ]]; then
  cp -R "$ROOT_DIR/drizzle" "$RES_DIR/drizzle"
  echo "✅  Copied drizzle migrations: $(ls "$RES_DIR/drizzle" | wc -l) files"
else
  echo "⚠️   No drizzle/ directory found in project root — skipping"
fi

# Sanity check
test -f "$RES_DIR/server.js"            || { echo "❌  Missing server.js"           >&2; exit 1; }
test -d "$RES_DIR/.next/static"         || { echo "❌  Missing .next/static"         >&2; exit 1; }
test -f "$RES_DIR/drizzle/meta/_journal.json" || { echo "❌  Missing drizzle/_journal.json" >&2; exit 1; }

echo "✅  Resources assembled at: $RES_DIR"
du -sh "$RES_DIR" 2>/dev/null || true

# ── step 4: tauri build ───────────────────────────────────────────────────────

echo ""
echo "🦀  Running Tauri build …"
source ~/.cargo/env 2>/dev/null || true
(
  cd "$ROOT_DIR/tauri"
  npm install
  # fakeroot makes file operations appear to use uid/gid 0, which prevents
  # Tauri's ar-based deb builder from embedding real uid/gid (e.g. 101615/906101)
  # that would corrupt the ar header and produce an uninstallable package.
  fakeroot npx tauri build
)

echo ""
echo "🎉  Done!  Installers are in:"
echo "    $TAURI_DIR/target/release/bundle/"
ls "$TAURI_DIR/target/release/bundle/" 2>/dev/null || true
