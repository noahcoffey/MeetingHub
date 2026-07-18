"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../confirm-dialog";

export function PersonHeader({
  person,
}: {
  person: { id: string; name: string; email: string | null };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() || null }),
      });
      if (!res.ok) throw new Error();
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    await fetch(`/api/people/${person.id}`, { method: "DELETE" });
    router.push("/people");
  }

  if (editing) {
    return (
      <form className="detail-header project-edit-form" onSubmit={save}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <input
          type="email"
          value={email}
          placeholder="Email (matches meeting attendees)"
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="new-meeting-actions">
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <header className="detail-header">
      <div className="detail-title-row">
        <h1 className="page-title">{person.name}</h1>
        <div className="detail-title-actions">
          <button type="button" className="row-action" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="row-action danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        </div>
      </div>
      {person.email && <p className="muted">{person.email}</p>}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this person?"
        message="Their agenda items are removed; tasks waiting on them are kept and detached. Meetings are untouched."
        confirmLabel="Delete person"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </header>
  );
}
