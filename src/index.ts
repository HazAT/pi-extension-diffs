import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, existsSync } from "node:fs";

const baseDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(baseDir, "..", "dist");
const viewerPath = join(distDir, "viewer.js");
const shellPath = join(distDir, "shell.html");
const glimpsePath = join(
  baseDir,
  "..",
  "node_modules",
  "glimpseui",
  "src",
  "glimpse.mjs"
);

let win: any = null;
let openFn: any = null;
let ready = false;
let readyResolve: (() => void) | null = null;

/**
 * Write shell.html to dist/ — a tiny HTML file with a loading spinner
 * that loads viewer.js via <script> after the first paint.
 * WKWebView loads both files from disk, no stdin overhead.
 */
function writeShellHTML() {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; }
  body {
    background: #0a0a0a;
    color: #fbfbfb;
    font-family: system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  #app { height: 100%; display: none; }

  /* ─── Loading ─── */
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 20px;
  }
  .loading-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255,255,255,0.08);
    border-top-color: rgba(255,255,255,0.4);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .loading-text {
    font-size: 12px;
    color: rgba(255,255,255,0.2);
    letter-spacing: 0.3px;
  }

  /* ─── Layout ─── */
  .layout { display: flex; height: 100%; }

  /* ─── Sidebar ─── */
  .sidebar {
    width: 260px; min-width: 260px;
    background: #0e0e0e;
    border-right: 1px solid rgba(255,255,255,0.08);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .sidebar-header {
    padding: 14px 16px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex; align-items: baseline; gap: 8px; flex-shrink: 0;
  }
  .sidebar-repo { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.9); }
  .sidebar-count { font-size: 11px; color: rgba(255,255,255,0.35); margin-left: auto; }
  .sidebar-files { flex: 1; overflow-y: auto; padding: 8px 0; }
  .sidebar-files::-webkit-scrollbar { width: 5px; }
  .sidebar-files::-webkit-scrollbar-track { background: transparent; }
  .sidebar-files::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }

  .sidebar-section { margin-bottom: 4px; }
  .sidebar-section-header {
    display: flex; align-items: center; gap: 7px; padding: 6px 16px; user-select: none;
  }
  .sidebar-section-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .sidebar-section-label {
    font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.45);
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .sidebar-section-count {
    font-size: 10px; color: rgba(255,255,255,0.25); margin-left: auto;
    background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 8px;
  }

  .sidebar-file {
    padding: 6px 16px 6px 14px; border-left: 2px solid transparent;
    cursor: pointer; transition: background 0.1s;
  }
  .sidebar-file:hover { background: rgba(255,255,255,0.04); }
  .sidebar-file.active { background: rgba(255,255,255,0.07); }
  .sidebar-file-name {
    font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.85);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    display: flex; align-items: center; gap: 6px;
  }
  .sidebar-file-tab-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .sidebar-file-path {
    font-size: 10px; color: rgba(255,255,255,0.25);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin-top: 1px; min-height: 13px;
  }
  .sidebar-file-stats { display: flex; gap: 6px; margin-top: 2px; }
  .stat-add { font-size: 10px; color: #00cab1; font-weight: 500; font-variant-numeric: tabular-nums; }
  .stat-del { font-size: 10px; color: #ff2e3f; font-weight: 500; font-variant-numeric: tabular-nums; }

  /* ─── Main panel ─── */
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

  .tab-bar {
    display: flex; background: #0e0e0e;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    overflow-x: auto; flex-shrink: 0; -webkit-app-region: no-drag;
  }
  .tab-bar::-webkit-scrollbar { height: 0; }
  .tab {
    display: flex; align-items: center; gap: 6px; padding: 8px 14px;
    font-size: 12px; color: rgba(255,255,255,0.5); cursor: pointer;
    white-space: nowrap; border-right: 1px solid rgba(255,255,255,0.04);
    flex-shrink: 0; transition: background 0.1s;
  }
  .tab:hover { background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.7); }
  .tab-active { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); }
  .tab-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .tab-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
  .tab-close {
    font-size: 14px; line-height: 1; color: rgba(255,255,255,0.25);
    cursor: pointer; padding: 0 2px; border-radius: 3px;
  }
  .tab-close:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.1); }

  .main-content { flex: 1; overflow: hidden; position: relative; }
  .tab-panel { height: 100%; overflow-y: auto; overflow-x: hidden; }
  .tab-panel::-webkit-scrollbar { width: 8px; }
  .tab-panel::-webkit-scrollbar-track { background: transparent; }
  .tab-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
  .diff-content { padding: 0; }

  .empty-state {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: rgba(255,255,255,0.25); font-size: 13px;
  }

  :root {
    --diffs-dark: #fbfbfb;
    --diffs-dark-bg: #0a0a0a;
    --diffs-dark-addition-color: #00cab1;
    --diffs-dark-deletion-color: #ff2e3f;
    --diffs-dark-modified-color: #009fff;
  }
</style>
</head>
<body>
<div id="loading" class="loading">
  <div class="loading-spinner"></div>
  <div class="loading-text">Loading viewer…</div>
</div>
<div id="app"></div>
<script>
// Small delay lets the spinner paint before the heavy JS parse starts.
// Using setTimeout instead of rAF because rAF doesn't fire in hidden windows (prewarm).
setTimeout(function() {
  var s = document.createElement('script');
  s.src = 'viewer.js';
  document.body.appendChild(s);
}, 10);
</script>
</body>
</html>`;
  writeFileSync(shellPath, html);
}

/** Wire up window events. */
function wireWindow(w: any) {
  w.loadFile(shellPath);

  w.on("message", (data: any) => {
    if (data?.type === "viewer-ready") {
      ready = true;
      if (readyResolve) {
        readyResolve();
        readyResolve = null;
      }
    }
  });

  w.on("closed", () => {
    win = null;
    ready = false;
    readyResolve = null;
    setTimeout(() => prewarm(), 100);
  });
}

/** Prewarm: hidden window with viewer.js already parsed. */
function prewarm() {
  if (!openFn || !existsSync(shellPath) || win) return;

  // Pass null — we'll loadFile in the ready handler
  win = openFn(null, {
    width: 1120,
    height: 760,
    title: "Diffs",
    hidden: true,
  });
  ready = false;
  wireWindow(win);
}

/** Wait for viewer.js to finish loading (with timeout). */
function waitForReady(timeoutMs = 15000): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      readyResolve = null;
      reject(new Error("Timed out waiting for viewer to load"));
    }, timeoutMs);
    readyResolve = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

export default function (pi: ExtensionAPI) {
  // Write shell.html, load glimpse, then prewarm
  (async () => {
    try {
      if (!existsSync(viewerPath)) return;
      writeShellHTML();
      const glimpse = await import(glimpsePath);
      openFn = glimpse.open;
      prewarm();
    } catch {
      // Silently fail — prewarm is best-effort
    }
  })();

  pi.registerCommand("diffs", {
    description: "Show git diffs in a native window",
    handler: async (_args, ctx) => {
      if (!existsSync(viewerPath)) {
        ctx.ui.notify(
          "Viewer not built. Run: cd ~/Projects/pi-extension-diffs && npm run build",
          "error"
        );
        return;
      }

      if (!openFn) {
        try {
          const glimpse = await import(glimpsePath);
          openFn = glimpse.open;
        } catch (e: any) {
          ctx.ui.notify(`Failed to load Glimpse: ${e.message}`, "error");
          return;
        }
      }

      // Ensure shell.html exists
      if (!existsSync(shellPath)) writeShellHTML();

      const gitCheck = await pi.exec("git", [
        "rev-parse",
        "--is-inside-work-tree",
      ]);
      if (gitCheck.code !== 0) {
        ctx.ui.notify("Not in a git repository", "error");
        return;
      }

      const [stagedResult, unstagedResult, untrackedResult, branchResult] =
        await Promise.all([
          pi.exec("git", ["diff", "--cached"]),
          pi.exec("git", ["diff"]),
          pi.exec("git", ["ls-files", "--others", "--exclude-standard"]),
          pi.exec("git", ["branch", "--show-current"]),
        ]);

      const staged = stagedResult.stdout || "";
      const unstaged = unstagedResult.stdout || "";
      const untrackedPaths = untrackedResult.stdout
        .split("\n")
        .filter((p) => p.trim());
      const branch = branchResult.stdout.trim();

      // Gather commits (up to 5)
      const isMain = branch === "main" || branch === "master";
      let commitLogResult;
      if (isMain) {
        commitLogResult = await pi.exec("git", [
          "log",
          "HEAD",
          "--max-count=5",
          '--format=%h|%s|%ar',
        ]);
      } else {
        commitLogResult = await pi.exec("git", [
          "log",
          "main..HEAD",
          "--max-count=5",
          '--format=%h|%s|%ar',
        ]);
        if (commitLogResult.code !== 0) {
          commitLogResult = await pi.exec("git", [
            "log",
            "master..HEAD",
            "--max-count=5",
            '--format=%h|%s|%ar',
          ]);
        }
        if (commitLogResult.code !== 0) {
          commitLogResult = await pi.exec("git", [
            "log",
            "HEAD",
            "--max-count=5",
            '--format=%h|%s|%ar',
          ]);
        }
      }

      const commitLines = (commitLogResult.stdout || "")
        .split("\n")
        .filter((l) => l.trim());

      const commits: { hash: string; message: string; time: string; diff: string }[] = [];
      for (const line of commitLines) {
        const parts = line.split("|");
        const hash = parts[0] ?? "";
        const time = parts[parts.length - 1] ?? "";
        const message = parts.slice(1, parts.length - 1).join("|");
        if (!hash) continue;
        const diffResult = await pi.exec("git", [
          "show",
          hash,
          "--format=",
          "--patch",
        ]);
        commits.push({ hash, message, time, diff: diffResult.stdout || "" });
      }

      if (!staged && !unstaged && untrackedPaths.length === 0 && commits.length === 0) {
        ctx.ui.notify("No changes", "info");
        return;
      }

      const untracked: { path: string; content: string }[] = [];
      for (const filePath of untrackedPaths) {
        try {
          const result = await pi.exec("cat", [filePath]);
          if (result.code === 0) {
            untracked.push({ path: filePath, content: result.stdout });
          }
        } catch {}
      }

      const repoName = basename(ctx.cwd);
      const data = { staged, unstaged, untracked, repoName, branch, commits };
      const dataJSON = JSON.stringify(data);

      // Open window if needed
      if (!win) {
        win = openFn(null, {
          width: 1120,
          height: 760,
          title: `Diffs — ${repoName}`,
        });
        ready = false;
        wireWindow(win);
      }

      try {
        await waitForReady();
      } catch (e: any) {
        ctx.ui.notify(`Diffs viewer failed: ${e.message}`, "error");
        win = null;
        ready = false;
        return;
      }

      win.send(`window.updateDiffs(${dataJSON})`);
      win.show({ title: `Diffs — ${repoName}` });
    },
  });
}
