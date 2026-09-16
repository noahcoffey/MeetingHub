"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import type { Mark } from "@tiptap/pm/model";

export type MarkdownEditorHandle = {
  setMarkdown: (md: string) => void;
  focus: () => void;
};

// tiptap-markdown adds a `markdown` storage bucket but doesn't augment the type.
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as {
    markdown: { getMarkdown: () => string };
  };
  return storage.markdown.getMarkdown();
}

type Selection = { text: string; top: number; left: number };

// ---- paste a URL, get a titled link -------------------------------------
//
// Pasting a bare URL inserts it as a link immediately (so nothing is ever lost
// or blocked on the network), then asks the server for the page title and
// swaps the link *text* for it — leaving `[Title](url)` in the markdown. The
// fetch is fire-and-forget: if it fails, times out, or the user has since
// edited that text, the bare URL simply stays.

// A single http(s) token and nothing else. Anything with whitespace, or a
// multi-line paste that happens to start with a URL, falls through to the
// normal paste handling.
function bareUrl(text: string): string | null {
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

// Swaps the text of the link we just inserted for the resolved title. Matches
// on "text node that is exactly this URL and carries a link mark pointing at
// it" — if the user has typed into it meanwhile there's no match and we leave
// the document alone rather than guess at a position.
function applyResolvedTitle(view: EditorView, url: string, title: string) {
  const { state } = view;
  let from = -1;
  let marks: readonly Mark[] = [];
  state.doc.descendants((node, pos) => {
    if (from >= 0) return false;
    if (!node.isText || node.text !== url) return;
    const link = node.marks.find(
      (m) => m.type.name === "link" && m.attrs.href === url,
    );
    if (link) {
      from = pos;
      marks = node.marks;
    }
  });
  if (from < 0) return;
  const to = from + url.length;
  const tr = state.tr
    .replaceWith(from, to, state.schema.text(title, [...marks]))
    .setMeta("preventAutolink", true);
  // Same boundary problem as the insert below: if the caret is sitting at the
  // end of what we just retitled, keep it outside the link.
  if (state.selection.empty && state.selection.from === to) {
    const linkType = state.schema.marks.link;
    if (linkType) tr.removeStoredMark(linkType);
  }
  view.dispatch(tr);
}

async function resolveTitle(view: EditorView, url: string) {
  let title: string | null = null;
  try {
    const res = await fetch(`/api/link-title?url=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    const data: unknown = await res.json();
    const t = (data as { title?: unknown } | null)?.title;
    title = typeof t === "string" && t.trim() ? t.trim() : null;
  } catch {
    return;
  }
  if (!title || view.isDestroyed) return;
  applyResolvedTitle(view, url, title);
}

// Returns true when it has handled the paste itself.
function handleUrlPaste(view: EditorView, event: ClipboardEvent): boolean {
  const url = bareUrl(event.clipboardData?.getData("text/plain")?.trim() ?? "");
  if (!url) return false;
  const { state } = view;
  // Over a selection, Link's own linkOnPaste already does the right thing
  // (wrap the selected text); inside code — block or inline mark, both of which
  // autolink also skips — a URL must stay literal.
  const $from = state.selection.$from;
  const codeMark = state.schema.marks.code;
  if (
    !state.selection.empty ||
    $from.parent.type.spec.code ||
    (codeMark && codeMark.isInSet($from.marks()))
  ) {
    return false;
  }
  const linkType = state.schema.marks.link;
  if (!linkType) return false;

  const tr = state.tr
    .replaceSelectionWith(
      state.schema.text(url, [linkType.create({ href: url })]),
      false,
    )
    .setMeta("preventAutolink", true)
    .scrollIntoView();
  // The link mark is inclusive (tiptap ties that to its autolink option), so
  // without this the caret is left *inside* the link and everything typed next
  // — the rest of the sentence — gets swallowed into the link text.
  tr.removeStoredMark(linkType);
  view.dispatch(tr);
  void resolveTitle(view, url);
  return true;
}

// Live-preview markdown editor: markdown is rendered inline as you type
// (headings, bold, lists, clickable checkboxes) but content round-trips as markdown
// so the autosave/offline/conflict logic upstream keeps operating on a markdown string.
export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  {
    initialMarkdown: string;
    onChange: (markdown: string) => void;
    onAddActionItem?: (text: string) => void;
    // Flip off to lock the editor (e.g. while its content is being moved).
    editable?: boolean;
  }
>(function MarkdownEditor(
  { initialMarkdown, onChange, onAddActionItem, editable = true },
  ref,
) {
  const [sel, setSel] = useState<Selection | null>(null);

  const editor = useEditor({
    immediatelyRender: false, // avoid SSR hydration mismatch
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: true,
        transformPastedText: true,
      }),
    ],
    content: initialMarkdown,
    onUpdate: ({ editor }) => {
      onChange(getMarkdown(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setSel(null);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, " ").trim();
      const domSel = window.getSelection();
      if (!text || !domSel || domSel.rangeCount === 0) {
        setSel(null);
        return;
      }
      const rect = domSel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSel(null);
        return;
      }
      setSel({ text, top: rect.top, left: rect.left + rect.width / 2 });
    },
    onBlur: () => setSel(null),
    editorProps: {
      attributes: {
        class: "notes-prose",
        spellcheck: "true",
      },
      handlePaste: (view, event) => handleUrlPaste(view, event),
    },
  });

  // Hide the toolbar on scroll/resize since it's positioned to the viewport.
  useEffect(() => {
    // emitUpdate=false: toggling must not look like a content edit upstream.
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  useEffect(() => {
    if (!sel) return;
    const hide = () => setSel(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [sel]);

  useImperativeHandle(
    ref,
    () => ({
      setMarkdown(md: string) {
        // Replace content without firing onUpdate — the caller manages save state.
        editor?.commands.setContent(md, { emitUpdate: false });
      },
      focus() {
        editor?.commands.focus("end");
      },
    }),
    [editor],
  );

  return (
    <>
      <EditorContent editor={editor} className="notes-editor-content" />
      {sel && (
        <div
          className="sel-toolbar"
          role="toolbar"
          style={{ top: sel.top, left: sel.left }}
          // preventDefault keeps the editor focused/selected when clicking a button
          onMouseDown={(e) => e.preventDefault()}
        >
          {onAddActionItem && (
            <button
              type="button"
              className="sel-action"
              onClick={() => {
                onAddActionItem(sel.text);
                setSel(null);
                editor?.commands.blur();
              }}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                <path d="M10 4.5v11M4.5 10h11" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Add Action Item
            </button>
          )}
          <button
            type="button"
            className="sel-action"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("mh:open-search", { detail: sel.text }),
              );
              setSel(null);
              editor?.commands.blur();
            }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
              <circle cx="9" cy="9" r="5" strokeWidth="1.6" />
              <path d="M13 13l3.5 3.5" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            Search for this
          </button>
        </div>
      )}
    </>
  );
});
