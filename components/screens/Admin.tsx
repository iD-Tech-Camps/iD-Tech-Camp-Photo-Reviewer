"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import {
  fetchTriageConfig,
  updateTriageConfig,
  type TriageConfig,
} from "@/lib/triage-config";
import { BrandLogo, PageHeader, type ToastApi } from "@/components/Shell";
import { useSettings, AppSettings } from "@/components/settings";
import { useCurrentUser, ROLE_LABEL } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/client";
import { brandingAssetUrl } from "@/lib/app-settings";
import {
  fetchAdminRoster,
  updateReviewerProfile,
  type RosterRow,
} from "@/lib/admin-roster";
import type { Role } from "@/lib/current-user";
import {
  createTag,
  deleteTag,
  fetchTags,
  groupTagsByCategory,
  setTagActive,
  slugifyTagId,
  TAG_CATEGORY_LABELS,
  updateTagCategory,
  type Tag,
  type TagCategory,
} from "@/lib/tags";

// The real Admin → SmugMug screen lives in [./AdminSmugMug.tsx]; re-exported
// here so App.tsx's barrel-style import doesn't churn. Step 8.5 retired the
// static placeholder that originally shipped from this file.
export { SmugMugImport } from "./AdminSmugMug";

// ─────────────────────────────────────────────────────────────────────────────
// AdminTags — extracted from the old AdminPoints' TagLibrary card so admins
// can keep curating the ops-rubric flag catalog while the rest of the
// triage UI is being built. Migration 26 dropped the `kind` discriminator;
// every tag is a single list now (no positive/negative split).
// ─────────────────────────────────────────────────────────────────────────────

export function AdminTags() {
  const supabase = React.useMemo(() => createClient(), []);
  const [tags, setTags] = React.useState<Tag[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState("");
  const [newCategory, setNewCategory] = React.useState<TagCategory>("general");
  const [busy, setBusy] = React.useState(false);
  const [opError, setOpError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchTags(supabase)
      .then((rows) => { if (!cancelled) setTags(rows); })
      .catch((err) => {
        console.error("[admin-tags] fetch failed:", err);
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load tags");
          setTags([]);
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  React.useEffect(() => { if (adding && inputRef.current) inputRef.current.focus(); }, [adding]);

  const activeTags = (tags ?? []).filter((t) => t.active);
  const inactiveTags = (tags ?? []).filter((t) => !t.active);

  const canSave = newLabel.trim().length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    const label = newLabel.trim();
    const slug = slugifyTagId(label) || `tag-${Date.now()}`;
    if ((tags ?? []).some((t) => t.id === slug)) {
      setOpError(`A tag with id "${slug}" already exists. Try a different label.`);
      return;
    }
    setBusy(true);
    setOpError(null);
    try {
      const nextOrder = Math.max(0, ...activeTags.map((t) => t.displayOrder)) + 1;
      const created = await createTag(supabase, {
        id: slug, label, displayOrder: nextOrder, category: newCategory,
      });
      setTags((prev) => [...(prev ?? []), created]);
      setNewLabel("");
      setAdding(false);
    } catch (err: any) {
      console.error("[admin-tags] create failed:", err);
      setOpError(err?.message ?? "Couldn't create tag");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setAdding(false);
    setNewLabel("");
    setOpError(null);
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setOpError(null);
    try {
      await deleteTag(supabase, id);
      setTags((prev) => (prev ?? []).filter((t) => t.id !== id));
    } catch (err: any) {
      // FK-restrict from triage_event_tags → fall back to soft-delete
      // when a tag is referenced by historical triage events.
      const code = err?.code ?? "";
      const looksLikeFkViolation = code === "23503" ||
        /violates foreign key/i.test(err?.message ?? "");
      if (looksLikeFkViolation) {
        try {
          await setTagActive(supabase, id, false);
          setTags((prev) =>
            (prev ?? []).map((t) => (t.id === id ? { ...t, active: false } : t)),
          );
        } catch (softErr: any) {
          console.error("[admin-tags] soft-delete failed:", softErr);
          setOpError(softErr?.message ?? "Couldn't deactivate tag");
        }
      } else {
        console.error("[admin-tags] delete failed:", err);
        setOpError(err?.message ?? "Couldn't remove tag");
      }
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setOpError(null);
    try {
      await setTagActive(supabase, id, true);
      setTags((prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, active: true } : t)),
      );
    } catch (err: any) {
      console.error("[admin-tags] reactivate failed:", err);
      setOpError(err?.message ?? "Couldn't reactivate tag");
    } finally {
      setBusy(false);
    }
  };

  const chipStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "5px 10px", borderRadius: 999,
    fontSize: 12, fontWeight: 500,
    background: "var(--sun-soft)",
    color: "var(--sun)",
    border: "1px solid transparent",
  };

  const inactiveChipStyle: React.CSSProperties = {
    ...chipStyle,
    background: "var(--paper-2)",
    color: "var(--ink-3)",
    textDecoration: "line-through",
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Issue library"
        title="<em>Review</em> issues."
        sub={tags === null
          ? "Loading current issue library…"
          : `${activeTags.length} active issue${activeTags.length === 1 ? "" : "s"}.${inactiveTags.length > 0 ? ` · ${inactiveTags.length} retired.` : ""}`}
      />

      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 4 }}>Active issues</h3>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
            What reviewers can attach to a photo during review. Add custom
            issues here and they&apos;ll show up automatically in the
            reviewer UI.
          </div>

          {loadError && (
            <div style={{
              padding: 10, marginBottom: 12,
              border: "1px solid var(--rose)", borderRadius: 6,
              background: "var(--rose-soft)", color: "var(--rose)",
              fontSize: 12,
            }}>
              Couldn&apos;t load issues: {loadError}
            </div>
          )}

          {Array.from(groupTagsByCategory(activeTags).entries()).map(([cat, list]) =>
            list.length === 0 ? null : (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {TAG_CATEGORY_LABELS[cat]}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {list.map((t) => (
                    <span key={t.id} style={chipStyle}>
                      {t.label}
                      <select
                        value={t.category}
                        disabled={busy}
                        onChange={(e) => {
                          const next = e.target.value as TagCategory;
                          void updateTagCategory(supabase, t.id, next).then(() => {
                            setTags((prev) =>
                              (prev ?? []).map((x) => (x.id === t.id ? { ...x, category: next } : x)),
                            );
                          });
                        }}
                        style={{ fontSize: 10, marginLeft: 4, border: "none", background: "transparent" }}
                        title="Category"
                      >
                        {(Object.keys(TAG_CATEGORY_LABELS) as TagCategory[]).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => remove(t.id)}
                        disabled={busy}
                        style={{
                          marginLeft: 2, color: "var(--sun)", opacity: busy ? 0.3 : 0.6,
                          display: "grid", placeItems: "center",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                        title="Remove"
                      >
                        <Icon name="x" size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ),
          )}
          {tags !== null && activeTags.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
              No active issues yet
            </span>
          )}

          {opError && (
            <div style={{
              padding: 10, marginBottom: 12,
              border: "1px solid var(--rose)", borderRadius: 6,
              background: "var(--rose-soft)", color: "var(--rose)",
              fontSize: 12,
            }}>
              {opError}
            </div>
          )}

          {adding ? (
            <div style={{
              marginTop: 8,
              padding: 12,
              background: "var(--paper-2)",
              border: "1px solid var(--rule)",
              borderRadius: 8,
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              <div>
                <label className="label" style={{ marginBottom: 4 }}>Label</label>
                <input
                  ref={inputRef}
                  className="input"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                    if (e.key === "Escape") cancel();
                  }}
                  placeholder="e.g. Peeling decals"
                  maxLength={48}
                />
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                  id: {slugifyTagId(newLabel) || "—"}
                </div>
              </div>
              <div>
                <label className="label" style={{ marginBottom: 4 }}>Category</label>
                <select
                  className="input"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as TagCategory)}
                >
                  {(Object.keys(TAG_CATEGORY_LABELS) as TagCategory[]).map((c) => (
                    <option key={c} value={c}>{TAG_CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" style={{ marginBottom: 4 }}>Preview</label>
                <span style={chipStyle}>
                  {newLabel.trim() || "Issue label"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
                <button className="btn btn-ghost" onClick={cancel} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" disabled={!canSave}
                  style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
                  onClick={save}>
                  <Icon name="plus" size={12} /> Add issue
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              disabled={tags === null}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px dashed var(--rule-2)",
                borderRadius: 8,
                background: "transparent",
                color: "var(--ink-2)",
                fontSize: 13, fontWeight: 500,
                cursor: tags === null ? "wait" : "pointer",
                opacity: tags === null ? 0.5 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <Icon name="plus" size={12} /> Add tag
            </button>
          )}
        </div>

        {inactiveTags.length > 0 && (
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Retired issues</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Issues that were used in past reviews but no longer show up in
              the reviewer UI. Reactivate to put one back in circulation.
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {inactiveTags.map(t => (
                <span key={t.id} style={inactiveChipStyle}>
                  {t.label}
                  <button
                    onClick={() => reactivate(t.id)}
                    disabled={busy}
                    style={{
                      marginLeft: 2, color: "var(--ink-2)", opacity: busy ? 0.3 : 0.6,
                      display: "grid", placeItems: "center",
                      cursor: busy ? "not-allowed" : "pointer",
                      textDecoration: "none",
                    }}
                    title="Reactivate"
                  >
                    <Icon name="plus" size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminOverview — reviewer roster (identity + role + team + last active).
// Per-user triage activity counts will be added when the rating system is
// rebuilt; until then this screen stays scoped to roster management.
// ─────────────────────────────────────────────────────────────────────────────

export function AdminOverview({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const { id: currentUserId } = useCurrentUser();
  const [roster, setRoster] = React.useState<RosterRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<RosterRow | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchAdminRoster(supabase)
      .then((rows) => { if (!cancelled) setRoster(rows); })
      .catch((err) => {
        console.error("[admin-overview] fetchAdminRoster failed:", err);
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load reviewer roster");
          setRoster([]);
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  // Persist a role/team edit. Optimistic UI: patch the local roster row
  // first, roll back on failure.
  const saveEdit = async (
    user: RosterRow,
    patch: { role: Role; team: string },
  ): Promise<boolean> => {
    const previous = roster;
    const trimmedTeam = patch.team.trim();
    const nextTeam = trimmedTeam.length === 0 ? null : trimmedTeam;
    setRoster((prev) => prev?.map((r) =>
      r.id === user.id ? { ...r, role: patch.role, team: nextTeam } : r,
    ) ?? prev);
    try {
      await updateReviewerProfile(supabase, user.id, {
        role: patch.role,
        team: patch.team,
      });
      toast.show(`Updated ${user.fullName ?? user.email.split("@")[0]}.`, "check");
      return true;
    } catch (err: any) {
      console.error("[admin-overview] update failed:", err);
      setRoster(previous ?? null);
      toast.show(err?.message ? `Couldn't save: ${err.message}` : "Couldn't save changes.");
      return false;
    }
  };

  const all = roster ?? [];
  const accountCount = all.length;

  // "Active in last 24h" = touched profiles.last_active_at within 24h;
  // bumped on every triage_events insert by
  // tg_triage_events_after_insert_bump_last_active (migration 28).
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const activeLast24h = all.filter((r) => {
    const t = Date.parse(r.lastActiveAt);
    return Number.isFinite(t) && now - t <= dayMs;
  }).length;

  // Case-insensitive match across name/email/team. Empty search = show all.
  const q = search.trim().toLowerCase();
  const visible = q
    ? all.filter((r) =>
        (r.fullName ?? "").toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.team ?? "").toLowerCase().includes(q),
      )
    : all;

  const subtitle = roster === null
    ? "Loading roster…"
    : `${accountCount} account${accountCount === 1 ? "" : "s"} · ${activeLast24h} active in last 24h`;

  return (
    <>
      <PageHeader
        eyebrow="Admin · Overview"
        title="<em>Reviewers.</em>"
        sub={subtitle}
      >
        <div style={{ position: "relative" }}>
          <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
          <input
            className="input"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 30, width: 220 }}
          />
        </div>
      </PageHeader>

      <div className="page-body">
        {loadError && (
          <div style={{
            padding: 12, marginBottom: 14,
            border: "1px solid var(--rose)", borderRadius: 8,
            background: "var(--rose-soft)", color: "var(--rose)",
            fontSize: 13,
          }}>
            Couldn&apos;t load roster: {loadError}
          </div>
        )}

        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Team</th>
                <th style={{ width: 130 }}>Last active</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {roster === null && <RosterSkeletonRows />}
              {roster !== null && visible.length === 0 && (
                <tr>
                  <td colSpan={5} style={{
                    textAlign: "center", padding: "24px 12px",
                    color: "var(--ink-3)", fontSize: 13,
                  }}>
                    {q
                      ? <>No reviewers match &ldquo;{search}&rdquo;.</>
                      : "No reviewer accounts yet."}
                  </td>
                </tr>
              )}
              {visible.map(u => (
                <ReviewerRow
                  key={u.id}
                  user={u}
                  onEdit={() => setEditing(u)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ReviewerEditModal
          user={editing}
          isSelf={!!currentUserId && currentUserId === editing.id}
          onCancel={() => setEditing(null)}
          onConfirm={async (patch) => {
            const ok = await saveEdit(editing, patch);
            if (ok) setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ReviewerRow({ user, onEdit }: { user: RosterRow; onEdit: () => void }) {
  const displayName = user.fullName ?? user.email.split("@")[0];
  const initials = (() => {
    if (user.fullName) {
      const parts = user.fullName.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    }
    const local = user.email.split("@")[0] ?? "";
    return local.slice(0, 2).toUpperCase() || "··";
  })();
  const rolePillClass = user.role === "admin"  ? "pill pill-sun"
                      : user.role === "senior" ? "pill pill-lake"
                      : "pill";

  return (
    <tr>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
            {initials}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{displayName}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{user.email}</div>
          </div>
        </div>
      </td>
      <td>
        <span className={rolePillClass}>{ROLE_LABEL[user.role]}</span>
      </td>
      <td style={{ fontSize: 13 }}>{user.team || "—"}</td>
      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
        {formatLastActive(user.lastActiveAt)}
      </td>
      <td>
        <button
          className="btn btn-ghost"
          style={{ padding: "4px 6px" }}
          onClick={onEdit}
          title="Edit reviewer"
          aria-label={`Edit ${displayName}`}
        >
          <Icon name="dots" size={14} />
        </button>
      </td>
    </tr>
  );
}

function ReviewerEditModal({
  user,
  isSelf,
  onCancel,
  onConfirm,
}: {
  user: RosterRow;
  isSelf: boolean;
  onCancel: () => void;
  onConfirm: (patch: { role: Role; team: string }) => Promise<void>;
}) {
  const [role, setRole] = React.useState<Role>(user.role);
  const [team, setTeam] = React.useState(user.team ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  // Lockout protection: don't let the only-or-current admin demote
  // themselves and lose access in the same click. They can still change
  // team. This is the cheapest version of the guard — counting other
  // admins to allow demotion when there's a peer is doable, but the
  // recovery story (edit profiles in SQL) is fine for now.
  const wouldLockOutSelf = isSelf && user.role === "admin" && role !== "admin";

  const dirty = role !== user.role || team.trim() !== (user.team ?? "");
  const canSave = dirty && !submitting && !wouldLockOutSelf;

  const submit = async () => {
    if (!canSave) return;
    setSubmitting(true);
    try {
      await onConfirm({ role, team });
    } finally {
      setSubmitting(false);
    }
  };

  const displayName = user.fullName ?? user.email.split("@")[0];

  return (
    <ModalShell
      eyebrow={isSelf ? "Edit your account" : "Edit reviewer"}
      title={displayName}
      tone="lake"
      onClose={onCancel}
      width={500}
    >
      <div style={{
        marginTop: -8, marginBottom: 18,
        fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)",
      }}>
        {user.email}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <FieldRow
          label="Role"
          hint={isSelf
            ? "You can't demote yourself out of the admin role from here. Change another admin first if you need to."
            : undefined}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {([
              ["reviewer", ROLE_LABEL.reviewer, "Reviews batches of camp photos."],
              ["senior",   ROLE_LABEL.senior,   "Plus approves weeks and acts on issues."],
              ["admin",    ROLE_LABEL.admin,    "Plus admin section."],
            ] as [Role, string, string][]).map(([id, label, hint]) => {
              const on = role === id;
              const disabled = isSelf && user.role === "admin" && id !== "admin";
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => !disabled && setRole(id)}
                  disabled={disabled}
                  style={{
                    padding: "10px 12px", borderRadius: 8,
                    border: on ? "1.5px solid var(--lake)" : "1px solid var(--rule)",
                    background: on ? "var(--lake-soft)" : "var(--paper)",
                    color: on ? "var(--ink)" : "var(--ink-2)",
                    textAlign: "left",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: on ? 500 : 400, marginBottom: 2 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{hint}</div>
                </button>
              );
            })}
          </div>
        </FieldRow>

        <FieldRow label="Team" hint="Free text — Operations, Programs, Marketing, Support, etc.">
          <input
            className="input"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="—"
            maxLength={48}
          />
        </FieldRow>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!canSave}
          style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
          onClick={submit}
        >
          <Icon name="check" size={12} /> {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </ModalShell>
  );
}

function RosterSkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} style={{ opacity: 0.4 }}>
          <td>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 11, background: "var(--paper-3)" }} />
              <div>
                <div style={{ height: 12, width: 120, background: "var(--paper-3)", borderRadius: 4, marginBottom: 4 }} />
                <div style={{ height: 10, width: 160, background: "var(--paper-3)", borderRadius: 4 }} />
              </div>
            </div>
          </td>
          <td><div style={{ height: 18, width: 80, background: "var(--paper-3)", borderRadius: 999 }} /></td>
          <td><div style={{ height: 12, width: 70, background: "var(--paper-3)", borderRadius: 4 }} /></td>
          <td><div style={{ height: 12, width: 60, background: "var(--paper-3)", borderRadius: 4 }} /></td>
          <td />
        </tr>
      ))}
    </>
  );
}

function formatLastActive(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60)  return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60)  return `${min}m ago`;
  const hr  = Math.round(min / 60);
  if (hr  < 24)  return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30)  return `${day}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminSettings — branding (auto-save) plus season bounds and triage knobs
// (explicit save on triage_config).
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT_OPTIONS: { id: AppSettings["accent"]; label: string; color: string }[] = [
  { id: "sun",  label: "Sun",  color: "oklch(0.72 0.17 55)" },
  { id: "lake", label: "Lake", color: "oklch(0.58 0.11 230)" },
  { id: "moss", label: "Moss", color: "oklch(0.55 0.12 155)" },
  { id: "rose", label: "Rose", color: "oklch(0.62 0.16 25)" },
];

// Client-side favicon upload constraints. PNG only (covers 99% of admin
// needs and keeps the icons metadata type stable); 1 MB cap because a
// favicon shouldn't be heavier than a small CSS file. The bucket RLS
// allows whatever the admin uploads — these are UX-side guardrails.
const FAVICON_MAX_BYTES = 1 * 1024 * 1024;
const FAVICON_ACCEPT = "image/png";

type TriageForm = {
  seasonFirstWeekStart: string;
  seasonLastWeekStart: string;
  maxForTriagePerBurst: number;
  claimExpiryMinutes: number;
};

export function AdminSettings() {
  const { settings, hydrated, update, reset, setFavicon, saveError } = useSettings();
  const supabase = React.useMemo(() => createClient(), []);
  const [triageConfig, setTriageConfig] = React.useState<TriageConfig | null>(null);
  const [triageLoadError, setTriageLoadError] = React.useState<string | null>(null);
  const [triageSaveError, setTriageSaveError] = React.useState<string | null>(null);
  const [triageBusy, setTriageBusy] = React.useState(false);
  const [triageForm, setTriageForm] = React.useState<TriageForm>({
    seasonFirstWeekStart: "",
    seasonLastWeekStart: "",
    maxForTriagePerBurst: 200,
    claimExpiryMinutes: 60,
  });
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [faviconBusy, setFaviconBusy] = React.useState(false);
  const [faviconError, setFaviconError] = React.useState<string | null>(null);
  const faviconFileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchTriageConfig(supabase)
      .then((c) => {
        if (cancelled) return;
        setTriageConfig(c);
        setTriageForm({
          seasonFirstWeekStart: c.seasonFirstWeekStart,
          seasonLastWeekStart: c.seasonLastWeekStart,
          maxForTriagePerBurst: c.maxForTriagePerBurst,
          claimExpiryMinutes: c.claimExpiryMinutes,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setTriageLoadError(err?.message ?? "Failed to load review settings");
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  const triageDirty = triageConfig !== null && (
    triageForm.seasonFirstWeekStart !== triageConfig.seasonFirstWeekStart ||
    triageForm.seasonLastWeekStart !== triageConfig.seasonLastWeekStart ||
    triageForm.maxForTriagePerBurst !== triageConfig.maxForTriagePerBurst ||
    triageForm.claimExpiryMinutes !== triageConfig.claimExpiryMinutes
  );

  const saveTriage = async () => {
    if (!triageDirty || triageBusy) return;
    setTriageBusy(true);
    setTriageSaveError(null);
    try {
      const next = await updateTriageConfig(supabase, triageForm);
      setTriageConfig(next);
    } catch (err: unknown) {
      setTriageSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setTriageBusy(false);
    }
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    update({ [key]: value } as Partial<AppSettings>);

  const supabaseRef = React.useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const faviconUrl = settings.faviconStoragePath
    ? brandingAssetUrl(supabaseRef.current, settings.faviconStoragePath)
    : null;

  const onPickFaviconFile = (file: File | null) => {
    setFaviconError(null);
    if (!file) return;
    if (file.type !== FAVICON_ACCEPT) {
      setFaviconError("Favicon must be a PNG.");
      return;
    }
    if (file.size > FAVICON_MAX_BYTES) {
      setFaviconError("Favicon must be 1 MB or smaller.");
      return;
    }
    setFaviconBusy(true);
    setFavicon(file).finally(() => setFaviconBusy(false));
  };

  const onRemoveFavicon = () => {
    setFaviconError(null);
    setFaviconBusy(true);
    setFavicon(null).finally(() => setFaviconBusy(false));
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Settings"
        title="App <em>settings.</em>"
        sub={hydrated
          ? "Branding saves automatically. Season and review settings use Save below."
          : "Loading current settings from the database…"}
      >
        {confirmReset ? (
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button className="btn btn-primary"
              style={{ background: "var(--rose)" }}
              onClick={() => { reset(); setConfirmReset(false); }}>
              Confirm reset
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmReset(true)}>
            Reset to defaults
          </button>
        )}
      </PageHeader>

      {saveError && (
        <div className="page-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div style={{
            padding: 12, marginBottom: 14,
            border: "1px solid var(--rose)", borderRadius: 8,
            background: "var(--rose-soft)", color: "var(--rose)",
            fontSize: 13,
          }}>
            Couldn&apos;t save: {saveError}
          </div>
        </div>
      )}

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Branding</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Shown in the sidebar and in browser tab.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <FieldRow label="App name">
                <DebouncedTextInput className="input"
                  value={settings.brandName}
                  onCommit={(v) => set("brandName", v)}
                  maxLength={32} />
              </FieldRow>
              <FieldRow label="Tagline">
                <DebouncedTextInput className="input"
                  value={settings.brandTagline}
                  onCommit={(v) => set("brandTagline", v)}
                  maxLength={48} />
              </FieldRow>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Logo &amp; favicon</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Shown in the sidebar next to the app name and in the browser tab. PNG, max 1 MB. Leave empty to show no logo.
            </div>
            <input
              ref={faviconFileInputRef}
              type="file"
              accept={FAVICON_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                onPickFaviconFile(file);
                e.target.value = "";
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 56, height: 56, borderRadius: 8,
                  background: "var(--paper-3)",
                  border: "1px solid var(--rule)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                {faviconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={faviconUrl}
                    alt="Current favicon"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>None</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  disabled={faviconBusy}
                  onClick={() => faviconFileInputRef.current?.click()}
                >
                  {faviconUrl ? "Replace" : "Upload"}
                </button>
                {faviconUrl && (
                  <button
                    className="btn btn-ghost"
                    disabled={faviconBusy}
                    onClick={onRemoveFavicon}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {faviconError && (
              <div style={{
                marginTop: 10, fontSize: 12, color: "var(--rose)",
              }}>
                {faviconError}
              </div>
            )}
            <div style={{
              marginTop: 10, fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5,
            }}>
              Browsers cache favicons aggressively — after a change, reviewers
              may need to hard-refresh before they see the new icon.
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Brand color</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Drives the accent (highlights, primary buttons, badges) across the app.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ACCENT_OPTIONS.map(opt => (
                <button key={opt.id}
                  onClick={() => set("accent", opt.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: settings.accent === opt.id ? "1.5px solid var(--ink)" : "1px solid var(--rule)",
                    background: settings.accent === opt.id ? "var(--paper-3)" : "var(--paper)",
                    cursor: "pointer", fontSize: 13,
                  }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: "50%",
                    background: opt.color, flexShrink: 0,
                  }} />
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{
              marginTop: 12, fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5,
            }}>
              Each reviewer chooses their own light/dark theme on the Profile screen.
            </div>
          </div>


          {triageLoadError && (
            <div style={{
              padding: 10,
              border: "1px solid var(--rose)", borderRadius: 6,
              background: "var(--rose-soft)", color: "var(--rose)",
              fontSize: 12,
            }}>
              Couldn&apos;t load season / review settings: {triageLoadError}
            </div>
          )}

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>The season</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Bounds which camp weeks count for review and which weeks SmugMug sync pulls photos for.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <FieldRow
                label="First camp week start"
                hint="Also controls which weeks SmugMug sync pulls photos for."
              >
                <input
                  type="date"
                  className="input"
                  disabled={triageConfig === null || triageBusy}
                  value={triageForm.seasonFirstWeekStart}
                  onChange={(e) => setTriageForm((f) => ({ ...f, seasonFirstWeekStart: e.target.value }))}
                />
              </FieldRow>
              <FieldRow
                label="Last camp week start"
                hint="Include weeks that start on or before this date."
              >
                <input
                  type="date"
                  className="input"
                  disabled={triageConfig === null || triageBusy}
                  value={triageForm.seasonLastWeekStart}
                  onChange={(e) => setTriageForm((f) => ({ ...f, seasonLastWeekStart: e.target.value }))}
                />
              </FieldRow>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Review</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Weekly sample schedule is fixed in cron (Tuesday 19:00 UTC). Reset samples and run a sample pull live on Photo sync.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <FieldRow label="Photos to sample each week">
                <input
                  type="number"
                  min={1}
                  className="input"
                  disabled={triageConfig === null || triageBusy}
                  value={triageForm.maxForTriagePerBurst}
                  onChange={(e) => setTriageForm((f) => ({
                    ...f,
                    maxForTriagePerBurst: Number(e.target.value),
                  }))}
                />
              </FieldRow>
              <FieldRow label="Release abandoned batches after (minutes)">
                <input
                  type="number"
                  min={1}
                  className="input"
                  disabled={triageConfig === null || triageBusy}
                  value={triageForm.claimExpiryMinutes}
                  onChange={(e) => setTriageForm((f) => ({
                    ...f,
                    claimExpiryMinutes: Number(e.target.value),
                  }))}
                />
              </FieldRow>
            </div>
          </div>

          {triageSaveError && (
            <div style={{
              padding: 10,
              border: "1px solid var(--rose)", borderRadius: 6,
              background: "var(--rose-soft)", color: "var(--rose)",
              fontSize: 12,
            }}>
              {triageSaveError}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveTriage}
              disabled={!triageDirty || triageBusy || triageConfig === null}
              style={{ opacity: triageDirty && !triageBusy ? 1 : 0.5 }}
            >
              <Icon name="check" size={12} /> {triageBusy ? "Saving…" : "Save season & review"}
            </button>
          </div>

        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 20, alignSelf: "start" }}>
          <div className="card">
            <div className="card-eyebrow">Live preview</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, marginBottom: 14 }}>
              How the sidebar looks right now.
            </div>

            <div style={{
              padding: 14, borderRadius: "var(--radius-sm)",
              background: "var(--paper-2)", border: "1px solid var(--rule)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{ flexShrink: 0 }}>
                <BrandLogo url={faviconUrl} alt={settings.brandName} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="brand-name" style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {settings.brandName}
                </div>
                <div className="brand-tag" style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {settings.brandTagline}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (FieldRow, ModalShell, DebouncedTextInput)
// ─────────────────────────────────────────────────────────────────────────────

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label className="label" style={{ marginBottom: 0 }}>{label}</label>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// Debounced text input that mirrors a settings field. Renders on every
// keystroke (instant feedback), but only calls onCommit after the user
// stops typing for `delay` ms, plus immediately on blur. Without this,
// every keystroke would punch through to a Supabase round-trip — fine
// for prototyping in localStorage, painfully chatty against a real DB.
function DebouncedTextInput({
  value,
  onCommit,
  delay = 500,
  className,
  type = "text",
  maxLength,
  style,
  transform,
}: {
  value: string;
  onCommit: (next: string) => void;
  delay?: number;
  className?: string;
  type?: string;
  maxLength?: number;
  style?: React.CSSProperties;
  transform?: (raw: string) => string;
}) {
  const [draft, setDraft] = React.useState(value);
  // Keep draft in sync if the canonical settings value changes from elsewhere
  // (e.g. a different tab, or an optimistic rollback after a save error).
  React.useEffect(() => { setDraft(value); }, [value]);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = React.useCallback((next: string) => {
    if (next !== value) onCommit(next);
  }, [value, onCommit]);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <input
      type={type}
      className={className}
      maxLength={maxLength}
      style={style}
      value={draft}
      onChange={(e) => {
        const next = transform ? transform(e.target.value) : e.target.value;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(next), delay);
      }}
      onBlur={() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        flush(draft);
      }}
    />
  );
}

// Minimal modal chrome shared by the ReviewerEditModal. Mirrors the
// shape AdminSmugMug.tsx uses internally so the two surfaces feel the
// same; the two can collapse to one primitive when a third caller arrives.
function ModalShell({
  title,
  eyebrow,
  tone,
  width = 520,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  tone: "moss" | "rose" | "sun" | "lake";
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const toneVar =
    tone === "moss" ? "var(--moss)" :
    tone === "rose" ? "var(--rose)" :
    tone === "sun"  ? "var(--sun)"  : "var(--lake)";
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(20, 25, 30, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid", placeItems: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: width,
          background: "var(--paper)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: 24,
          maxHeight: "85vh", overflowY: "auto",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: toneVar, marginBottom: 4,
          }}>{eyebrow}</div>
          <h2 style={{
            fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500,
            letterSpacing: "-0.02em", margin: 0,
          }}>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}
