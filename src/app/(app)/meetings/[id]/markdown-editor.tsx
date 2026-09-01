"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import type { Editor } from "@tiptap/react";

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
