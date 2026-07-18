"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

// Read-only render of a markdown string, using the same extensions as the editor so
// past-meeting notes look identical (headings, lists, checkboxes) but aren't editable.
export function MarkdownView({ markdown }: { markdown: string }) {
  const editor = useEditor({
    editable: false,
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false }),
    ],
    content: markdown,
  });
  return <EditorContent editor={editor} className="notes-prose pm-prose" />;
}
