import React, { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";

// Only where a reply leaves the building as a real email — a customer
// reading it in their own inbox expects the same formatting any other
// email client offers, not a bare box of plain text. Internal notes and
// web-raised tickets stay plain on purpose; see TicketDetail.jsx.
const ToolbarButton = ({ active, onClick, label, children }) => (
  <button
    type="button"
    className={`rte-btn${active ? " active" : ""}`}
    onMouseDown={(e) => {
      e.preventDefault(); // keep the editor's selection — a real click would steal focus first
      onClick();
    }}
    title={label}
    aria-label={label}
  >
    {children}
  </button>
);

// onSubmitEditor is optional — only a chat-style composer (Enter sends,
// Shift+Enter for a newline) passes it. A ticket reply stays plain Enter-for-
// newline, since that one is composing something closer to an email.
export const RichTextEditor = ({ value, onChange, placeholder, onSubmitEditor }) => {
  // A ref, not a plain closure over the prop — editorProps.handleKeyDown is
  // captured once when Tiptap builds the view, and onSubmitEditor is a fresh
  // arrow function on every parent render (it closes over the latest
  // composeBody/sending state), so calling the prop directly here would
  // permanently invoke whatever it was on the very first render.
  const onSubmitRef = useRef(onSubmitEditor);
  onSubmitRef.current = onSubmitEditor;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder || "Type your response here..." }),
    ],
    content: value || "",
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: { class: "rte-prose" },
      handleKeyDown: (_view, event) => {
        if (!onSubmitRef.current) return false;
        const isEnter = event.key === "Enter" || event.code === "Enter" || event.keyCode === 13 || event.which === 13;
        if (!isEnter || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
        event.preventDefault();
        onSubmitRef.current();
        return true;
      },
    },
  });

  // The caller clears `value` back to "" after a successful send — Tiptap
  // otherwise keeps whatever was last typed, since it owns its own state.
  useEffect(() => {
    if (editor && value === "" && !editor.isEmpty) editor.commands.clearContent();
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const previous = editor.getAttributes("link").href;
    const url = window.prompt("Link URL", previous || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <strong>{"B"}</strong>
        </ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <em>{"I"}</em>
        </ToolbarButton>
        <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <u>{"U"}</u>
        </ToolbarButton>
        <span className="rte-sep" />
        <ToolbarButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          {"• List"}
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          {"1. List"}
        </ToolbarButton>
        <span className="rte-sep" />
        <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
          {"Link"}
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};

export default RichTextEditor;
