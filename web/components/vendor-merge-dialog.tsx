"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { GitMerge, Plus, Sparkles, X, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addVendorToGroup,
  createVendorGroup,
  deleteVendorGroup,
  removeVendorFromGroup,
  renameVendorGroup,
} from "@/lib/actions";
import type { VendorGroupRow, VendorRow } from "@/lib/queries";
import { rankSimilarVendors } from "@/lib/utils";

// ── Small inline modal ───────────────────────────────────────────────────────

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] shadow-[var(--elev-3)]">
        {children}
      </div>
    </div>
  );
}

// ── Merge button shown per-vendor-row ────────────────────────────────────────

export function MergeVendorButton({
  vendorKey,
  vendorName,
  groups,
  currentGroupId,
  candidates = [],
}: {
  vendorKey: string;
  vendorName: string;
  groups: VendorGroupRow[];
  currentGroupId: string | null;
  /** Other vendors (standalone + groups) used to auto-suggest similar merges. */
  candidates?: VendorRow[];
}) {
  const [open, setOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Fuzzy name matches — the lightweight token/trigram ranker, no dependency.
  const suggestions = useMemo(
    () =>
      rankSimilarVendors(vendorName, candidates, (c) => c.displayName)
        .filter((s) => s.item.groupId !== currentGroupId),
    [vendorName, candidates, currentGroupId],
  );

  function close() {
    setOpen(false);
    setNewGroupName("");
  }

  function mergeInto(groupId: string) {
    startTransition(async () => {
      await addVendorToGroup(vendorKey, groupId);
      close();
    });
  }

  /**
   * Accept a fuzzy suggestion: merge into the candidate's existing group, or —
   * if the candidate is standalone — spin up a new group holding both vendors.
   */
  function mergeWithSuggestion(candidate: VendorRow) {
    startTransition(async () => {
      if (candidate.groupId) {
        await addVendorToGroup(vendorKey, candidate.groupId);
      } else {
        const groupId = await createVendorGroup(vendorName, vendorKey);
        if (groupId) await addVendorToGroup(candidate.vendorKey, groupId);
      }
      close();
    });
  }

  function createAndMerge() {
    const name = newGroupName.trim() || vendorName;
    startTransition(async () => {
      await createVendorGroup(name, vendorKey);
      close();
    });
  }

  function unmerge() {
    startTransition(async () => {
      await removeVendorFromGroup(vendorKey);
      close();
    });
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Merge with another vendor"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--faint)] opacity-0 transition-all hover:bg-[var(--panel)] hover:text-[var(--muted)] group-hover/row:opacity-100"
      >
        <GitMerge size={13} />
      </button>

      {open && (
        <Modal onClose={close}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">{vendorName}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Merge into a vendor group</p>
          </div>

          <div className="space-y-1 p-3">
            {suggestions.length > 0 && (
              <>
                <p className="flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--brass)]">
                  <Sparkles size={11} className="shrink-0" /> Similar vendors
                </p>
                {suggestions.map(({ item }) => (
                  <button
                    key={item.vendorKey}
                    disabled={isPending}
                    onClick={() => mergeWithSuggestion(item)}
                    className="flex w-full items-center gap-2.5 rounded-md border border-[var(--brass-dim)]/40 bg-[var(--brass)]/5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--brass)]/10 disabled:opacity-40"
                  >
                    <GitMerge size={13} className="shrink-0 text-[var(--brass)]" />
                    <span className="flex-1 truncate">{item.displayName}</span>
                    <span className="text-xs text-[var(--faint)]">
                      {item.groupId
                        ? `${item.members.length} vendors`
                        : `${item.count} ${item.count === 1 ? "txn" : "txns"}`}
                    </span>
                  </button>
                ))}
                <div className="my-2 border-t border-line/60" />
              </>
            )}

            {groups.length > 0 && (
              <>
                <p className="px-2 py-1 text-xs text-[var(--faint)]">Existing groups</p>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    disabled={isPending || g.id === currentGroupId}
                    onClick={() => mergeInto(g.id)}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--panel-2)] disabled:opacity-40"
                  >
                    <GitMerge size={13} className="shrink-0 text-[var(--brass)]" />
                    <span className="flex-1 truncate">{g.name}</span>
                    <span className="text-xs text-[var(--faint)]">{g.members.length} vendors</span>
                  </button>
                ))}
                <div className="my-2 border-t border-line/60" />
              </>
            )}

            <p className="px-2 py-1 text-xs text-[var(--faint)]">New group</p>
            <div className="flex gap-2 px-2 pb-1">
              <input
                ref={inputRef}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndMerge()}
                placeholder={vendorName}
                className="h-8 flex-1 rounded-md border border-line bg-[var(--panel-2)] px-3 text-sm placeholder:text-[var(--faint)] focus:outline-none focus:ring-1 focus:ring-[var(--brass-dim)]"
              />
              <Button size="sm" variant="outline" disabled={isPending} onClick={createAndMerge}>
                <Plus size={13} />
              </Button>
            </div>
          </div>

          {currentGroupId && (
            <div className="border-t border-line px-5 py-3">
              <button
                disabled={isPending}
                onClick={unmerge}
                className="flex items-center gap-2 text-xs text-[var(--coral)] transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                <X size={12} /> Remove from current group
              </button>
            </div>
          )}

          <div className="border-t border-line px-5 py-3">
            <button onClick={close} className="text-xs text-[var(--muted)] hover:text-[var(--paper)]">
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Group management shown in the detail panel ───────────────────────────────

export function VendorGroupDetail({
  groupId,
  groupName,
  members,
}: {
  groupId: string;
  groupName: string;
  members: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(groupName);
  const [isPending, startTransition] = useTransition();

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === groupName) { setEditing(false); return; }
    startTransition(async () => {
      await renameVendorGroup(groupId, trimmed);
      setEditing(false);
    });
  }

  function removeMember(vendorKey: string) {
    startTransition(async () => {
      await removeVendorFromGroup(vendorKey);
    });
  }

  function deleteGroup() {
    if (!confirm(`Delete the "${groupName}" group? Members will become standalone vendors again.`)) return;
    startTransition(async () => {
      await deleteVendorGroup(groupId);
    });
  }

  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-5">
      <div className="flex items-center gap-2">
        <GitMerge size={14} className="shrink-0 text-[var(--brass)]" />
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditing(false); }}
            className="flex-1 rounded border border-[var(--brass-dim)] bg-transparent px-2 py-0.5 text-sm focus:outline-none"
          />
        ) : (
          <span className="flex-1 text-sm font-medium">{groupName}</span>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-[var(--faint)] hover:text-[var(--muted)]"
          title="Rename group"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={deleteGroup}
          disabled={isPending}
          className="text-[var(--faint)] hover:text-[var(--coral)] disabled:opacity-40"
          title="Delete group"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <p className="text-xs text-[var(--muted)]">Merged vendor names</p>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <span
            key={m}
            className="flex items-center gap-1.5 rounded-full border border-line bg-[var(--panel-2)] px-2.5 py-1 text-xs"
          >
            {m}
            <button
              disabled={isPending}
              onClick={() => removeMember(m)}
              className="text-[var(--faint)] hover:text-[var(--coral)] disabled:opacity-40"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
