import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PatchDiff, MultiFileDiff } from "@pierre/diffs/react";
import type { FileDiffOptions } from "@pierre/diffs/react";

interface DiffData {
  staged: string;
  unstaged: string;
  untracked: { path: string; content: string }[];
  repoName: string;
}

interface FileEntry {
  id: string;
  name: string;
  path: string;
  section: "staged" | "unstaged" | "untracked";
  additions: number;
  deletions: number;
  patch?: string;
  content?: string;
}

declare global {
  interface Window {
    updateDiffs: (data: DiffData) => void;
  }
}

const SECTION_COLORS = {
  staged: "#00cab1",
  unstaged: "#F59E0B",
  untracked: "#3B82F6",
} as const;

const SECTION_LABELS = {
  staged: "Staged",
  unstaged: "Unstaged",
  untracked: "Untracked",
} as const;

const diffOptions: FileDiffOptions<undefined> = {
  theme: "pierre-dark",
  diffStyle: "unified",
  overflow: "scroll",
  themeType: "dark",
};

/** Split a combined git diff into individual per-file patches. */
function splitPatch(patch: string): string[] {
  const parts: string[] = [];
  const lines = patch.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      parts.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0 && current.some((l) => l.startsWith("diff --git "))) {
    parts.push(current.join("\n"));
  }
  return parts;
}

/** Extract file path from a git diff header like "diff --git a/foo/bar.ts b/foo/bar.ts" */
function extractPathFromPatch(patch: string): string {
  const match = patch.match(/^diff --git a\/(.*?) b\/(.*)/m);
  if (match) return match[2];
  return "unknown";
}

/** Count additions and deletions from a patch */
function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) continue; // skip hunk headers
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

/** Build file entries from diff data */
function buildFileEntries(data: DiffData): FileEntry[] {
  const entries: FileEntry[] = [];

  if (data.staged.trim()) {
    for (const patch of splitPatch(data.staged)) {
      const path = extractPathFromPatch(patch);
      const { additions, deletions } = countChanges(patch);
      entries.push({
        id: `staged:${path}`,
        name: path.split("/").pop() || path,
        path,
        section: "staged",
        additions,
        deletions,
        patch,
      });
    }
  }

  if (data.unstaged.trim()) {
    for (const patch of splitPatch(data.unstaged)) {
      const path = extractPathFromPatch(patch);
      const { additions, deletions } = countChanges(patch);
      entries.push({
        id: `unstaged:${path}`,
        name: path.split("/").pop() || path,
        path,
        section: "unstaged",
        additions,
        deletions,
        patch,
      });
    }
  }

  for (const { path, content } of data.untracked) {
    const lineCount = content.split("\n").length;
    entries.push({
      id: `untracked:${path}`,
      name: path.split("/").pop() || path,
      path,
      section: "untracked",
      additions: lineCount,
      deletions: 0,
      content,
    });
  }

  return entries;
}

// ─── Sidebar ───

function SidebarFile({
  file,
  active,
  tabbed,
  onClick,
}: {
  file: FileEntry;
  active: boolean;
  tabbed: boolean;
  onClick: () => void;
}) {
  const color = SECTION_COLORS[file.section];
  return (
    <div
      className={`sidebar-file ${active ? "active" : ""}`}
      onClick={onClick}
      style={active ? { borderLeftColor: color } : undefined}
    >
      <div className="sidebar-file-name" title={file.path}>
        {file.name}
        {tabbed && <span className="sidebar-file-tab-dot" style={{ background: color }} />}
      </div>
      <div className="sidebar-file-path">{file.path !== file.name ? file.path : ""}</div>
      <div className="sidebar-file-stats">
        {file.additions > 0 && <span className="stat-add">+{file.additions}</span>}
        {file.deletions > 0 && <span className="stat-del">−{file.deletions}</span>}
      </div>
    </div>
  );
}

function SidebarSection({
  section,
  files,
  activeId,
  openTabIds,
  onFileClick,
}: {
  section: "staged" | "unstaged" | "untracked";
  files: FileEntry[];
  activeId: string | null;
  openTabIds: Set<string>;
  onFileClick: (file: FileEntry) => void;
}) {
  if (files.length === 0) return null;
  const color = SECTION_COLORS[section];
  const label = SECTION_LABELS[section];

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <span className="sidebar-section-dot" style={{ background: color }} />
        <span className="sidebar-section-label">{label}</span>
        <span className="sidebar-section-count">{files.length}</span>
      </div>
      {files.map((f) => (
        <SidebarFile
          key={f.id}
          file={f}
          active={f.id === activeId}
          tabbed={openTabIds.has(f.id)}
          onClick={() => onFileClick(f)}
        />
      ))}
    </div>
  );
}

// ─── Tabs ───

function TabBar({
  tabs,
  activeId,
  filesMap,
  onSelect,
  onClose,
}: {
  tabs: string[];
  activeId: string | null;
  filesMap: Map<string, FileEntry>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((id) => {
        const file = filesMap.get(id);
        if (!file) return null;
        const color = SECTION_COLORS[file.section];
        const isActive = id === activeId;

        return (
          <div
            key={id}
            className={`tab ${isActive ? "tab-active" : ""}`}
            onClick={() => onSelect(id)}
          >
            <span className="tab-dot" style={{ background: color }} />
            <span className="tab-name">{file.name}</span>
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(id);
              }}
            >
              ×
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Diff Content ───

function DiffView({ file }: { file: FileEntry }) {
  if (file.section === "untracked") {
    return (
      <div className="diff-content">
        <MultiFileDiff
          oldFile={{ name: file.path, contents: "" }}
          newFile={{ name: file.path, contents: file.content || "" }}
          options={diffOptions}
        />
      </div>
    );
  }

  return (
    <div className="diff-content">
      <PatchDiff patch={file.patch || ""} options={diffOptions} />
    </div>
  );
}

// ─── Main App ───

function App({ data }: { data: DiffData }) {
  const files = useMemo(() => buildFileEntries(data), [data]);
  const filesMap = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Auto-select first file on load
  useEffect(() => {
    if (files.length > 0 && activeId === null) {
      const first = files[0];
      setOpenTabs([first.id]);
      setActiveId(first.id);
    }
  }, [files]);

  // When data updates, clean up tabs that no longer exist
  useEffect(() => {
    const validIds = new Set(files.map((f) => f.id));
    setOpenTabs((prev) => prev.filter((id) => validIds.has(id)));
    setActiveId((prev) => (prev && validIds.has(prev) ? prev : files[0]?.id || null));
  }, [files]);

  const handleFileClick = useCallback((file: FileEntry) => {
    setOpenTabs((prev) => (prev.includes(file.id) ? prev : [...prev, file.id]));
    setActiveId(file.id);
  }, []);

  const handleTabSelect = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleTabClose = useCallback(
    (id: string) => {
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t !== id);
        if (activeId === id) {
          const idx = prev.indexOf(id);
          const newActive = next[Math.min(idx, next.length - 1)] || null;
          // setTimeout to avoid state update during render
          setTimeout(() => setActiveId(newActive), 0);
        }
        return next;
      });
    },
    [activeId]
  );

  const grouped = useMemo(() => {
    const staged = files.filter((f) => f.section === "staged");
    const unstaged = files.filter((f) => f.section === "unstaged");
    const untracked = files.filter((f) => f.section === "untracked");
    return { staged, unstaged, untracked };
  }, [files]);

  const openTabSet = useMemo(() => new Set(openTabs), [openTabs]);
  const activeFile = activeId ? filesMap.get(activeId) : null;

  if (files.length === 0) {
    return <div className="empty-state">No changes</div>;
  }

  return (
    <div className="layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-repo">{data.repoName}</span>
          <span className="sidebar-count">{files.length} file{files.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="sidebar-files">
          {(["staged", "unstaged", "untracked"] as const).map((s) => (
            <SidebarSection
              key={s}
              section={s}
              files={grouped[s]}
              activeId={activeId}
              openTabIds={openTabSet}
              onFileClick={handleFileClick}
            />
          ))}
        </div>
      </div>

      {/* Main panel */}
      <div className="main">
        <TabBar
          tabs={openTabs}
          activeId={activeId}
          filesMap={filesMap}
          onSelect={handleTabSelect}
          onClose={handleTabClose}
        />
        <div className="main-content">
          {openTabs.map((id) => {
            const file = filesMap.get(id);
            if (!file) return null;
            return (
              <div
                key={id}
                className="tab-panel"
                style={{ display: id === activeId ? "block" : "none" }}
              >
                <DiffView file={file} />
              </div>
            );
          })}
          {openTabs.length === 0 && (
            <div className="empty-state">Select a file from the sidebar</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Error boundary
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: "#ff6b6b", fontFamily: "monospace", fontSize: 13 }}>
          <h3 style={{ marginBottom: 10 }}>Render Error</h3>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById("app")!);

window.updateDiffs = (data: DiffData) => {
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";
  document.getElementById("app")!.style.display = "block";
  root.render(
    <ErrorBoundary>
      <App data={data} />
    </ErrorBoundary>
  );
};

// Signal to Glimpse that the viewer bundle is loaded and ready
try {
  (window as any).webkit.messageHandlers.glimpse.postMessage(
    JSON.stringify({ type: "viewer-ready" })
  );
} catch {}

