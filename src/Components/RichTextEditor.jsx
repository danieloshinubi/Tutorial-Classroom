import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle, Color, FontFamily, FontSize } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import { Highlight } from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Icon } from "react-icons-kit";
import { ic_undo } from "react-icons-kit/md/ic_undo";
import { ic_redo } from "react-icons-kit/md/ic_redo";
import { ic_format_bold } from "react-icons-kit/md/ic_format_bold";
import { ic_format_italic } from "react-icons-kit/md/ic_format_italic";
import { ic_format_underlined } from "react-icons-kit/md/ic_format_underlined";
import { ic_format_strikethrough } from "react-icons-kit/md/ic_format_strikethrough";
import { ic_format_color_text } from "react-icons-kit/md/ic_format_color_text";
import { ic_border_color } from "react-icons-kit/md/ic_border_color";
import { ic_format_align_left } from "react-icons-kit/md/ic_format_align_left";
import { ic_format_align_center } from "react-icons-kit/md/ic_format_align_center";
import { ic_format_align_right } from "react-icons-kit/md/ic_format_align_right";
import { ic_format_align_justify } from "react-icons-kit/md/ic_format_align_justify";
import { ic_format_list_bulleted } from "react-icons-kit/md/ic_format_list_bulleted";
import { ic_format_list_numbered } from "react-icons-kit/md/ic_format_list_numbered";
import { ic_format_indent_decrease } from "react-icons-kit/md/ic_format_indent_decrease";
import { ic_format_indent_increase } from "react-icons-kit/md/ic_format_indent_increase";
import { ic_format_quote } from "react-icons-kit/md/ic_format_quote";
import { ic_horizontal_rule } from "react-icons-kit/md/ic_horizontal_rule";
import { ic_table_chart } from "react-icons-kit/md/ic_table_chart";
import { ic_insert_link } from "react-icons-kit/md/ic_insert_link";
import { ic_format_clear } from "react-icons-kit/md/ic_format_clear";
import { Select } from "./UI";
import { promptDialog } from "./Confirm";

// Only where a reply leaves the building as a real email — a customer
// reading it in their own inbox expects the same formatting any other
// email client offers, not a bare box of plain text. Internal notes and
// web-raised tickets stay plain on purpose; see TicketDetail.jsx.
const ToolbarButton = ({ active, onClick, label, disabled, children }) => (
  <button
    type="button"
    className={`rte-btn${active ? " active" : ""}`}
    onMouseDown={(e) => {
      e.preventDefault(); // keep the editor's selection — a real click would steal focus first
      if (!disabled) onClick();
    }}
    title={label}
    aria-label={label}
    aria-pressed={active === undefined ? undefined : !!active}
    disabled={disabled}
  >
    {children}
  </button>
);

const I = ({ icon }) => <Icon icon={icon} size={18} />;

// The full toolbar's pickers. Values are what goes into the email itself,
// so the fonts are ones every mail client has.
const STYLE_OPTIONS = [
  { value: "p", label: "Normal" },
  { value: "1", label: "Heading 1" },
  { value: "2", label: "Heading 2" },
  { value: "3", label: "Heading 3" },
];
const FONT_OPTIONS = [
  { value: "", label: "Font" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Calibri, Carlito, sans-serif", label: "Calibri" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet MS" },
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
];
const SIZE_OPTIONS = [
  { value: "", label: "Size" },
  ...["10", "12", "14", "16", "18", "20", "24", "28", "36"].map((n) => ({ value: `${n}px`, label: n })),
];
// Word's own "theme colours" row, roughly: dark to bright, then soft tints
// for highlighting.
const TEXT_COLOURS = [
  "#000000", "#434343", "#666666", "#999999", "#c0392b", "#d35400", "#b7950b", "#1e8449",
  "#117a65", "#1f618d", "#2e4bc6", "#6c3483", "#a93226", "#e67e22", "#2471a3", "#7d3c98",
];
const HIGHLIGHTS = ["#fff59d", "#ffe0b2", "#ffcdd2", "#f8bbd0", "#e1bee7", "#c5cae9", "#b3e5fc", "#c8e6c9"];

// Borders written onto the table itself: the email is read in someone
// else's mail app, which has none of this app's CSS, so a table with no
// inline border arrives as loose floating text.
const CELL_STYLE = "border:1px solid #d0d4dc;padding:6px 8px;vertical-align:top;";

// A toolbar menu opens under its button, left-aligned, and on a phone the
// ones towards the right (colour, table) ran off the screen. Measured once
// open, and pulled back in by however much it overhangs.
const useKeepInView = (open) => {
  const panelRef = useRef(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const over = rect.right - (window.innerWidth - 8);
    if (over > 0) setShift(-Math.min(over, Math.max(0, rect.left - 8)));
  }, [open]);
  return [panelRef, shift ? { left: shift } : undefined];
};

// A small swatch panel under a toolbar button (text colour, highlight).
const ColourMenu = ({ label, icon, colours, current, onPick, onClear, clearLabel, bar }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const [panelRef, panelStyle] = useKeepInView(open);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <span className="rte-menu" ref={wrapRef}>
      <ToolbarButton label={label} onClick={() => setOpen((v) => !v)}>
        <span className="rte-colour-btn">
          <I icon={icon} />
          <span className="rte-colour-bar" style={{ background: current || bar }} />
        </span>
      </ToolbarButton>
      {open ? (
        <div className="rte-pop" role="menu" ref={panelRef} style={panelStyle}>
          <div className="rte-swatches">
            {colours.map((c) => (
              <button
                key={c}
                type="button"
                className={`rte-swatch${current === c ? " active" : ""}`}
                style={{ background: c }}
                title={c}
                aria-label={c}
                onMouseDown={(e) => { e.preventDefault(); onPick(c); setOpen(false); }}
              />
            ))}
          </div>
          <button type="button" className="rte-pop-item" onMouseDown={(e) => { e.preventDefault(); onClear(); setOpen(false); }}>
            {clearLabel}
          </button>
        </div>
      ) : null}
    </span>
  );
};

const TableMenu = ({ editor, inTable }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const [panelRef, panelStyle] = useKeepInView(open);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const run = (fn) => (e) => { e.preventDefault(); fn(editor.chain().focus()).run(); setOpen(false); };
  return (
    <span className="rte-menu" ref={wrapRef}>
      <ToolbarButton label="Table" active={inTable} onClick={() => setOpen((v) => !v)}>
        <I icon={ic_table_chart} />
      </ToolbarButton>
      {open ? (
        <div className="rte-pop rte-pop-list" role="menu" ref={panelRef} style={panelStyle}>
          {!inTable ? (
            <>
              <button type="button" className="rte-pop-item" onMouseDown={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>{"Insert table (3 × 3)"}</button>
              <button type="button" className="rte-pop-item" onMouseDown={run((c) => c.insertTable({ rows: 2, cols: 2, withHeaderRow: false }))}>{"Insert table (2 × 2)"}</button>
            </>
          ) : (
            <>
              <button type="button" className="rte-pop-item" onMouseDown={run((c) => c.addRowAfter())}>{"Add row below"}</button>
              <button type="button" className="rte-pop-item" onMouseDown={run((c) => c.addColumnAfter())}>{"Add column right"}</button>
              <button type="button" className="rte-pop-item" onMouseDown={run((c) => c.deleteRow())}>{"Delete row"}</button>
              <button type="button" className="rte-pop-item" onMouseDown={run((c) => c.deleteColumn())}>{"Delete column"}</button>
              <button type="button" className="rte-pop-item danger" onMouseDown={run((c) => c.deleteTable())}>{"Delete table"}</button>
            </>
          )}
        </div>
      ) : null}
    </span>
  );
};

// onSubmitEditor is optional — only a chat-style composer (Enter sends,
// Shift+Enter for a newline) passes it. A ticket reply stays plain Enter-for-
// newline, since that one is composing something closer to an email.
//
// showToolbar (default true) lets a compact caller (chat's own pill
// composer) hide the toolbar until asked for.
//
// toolbar "basic" (bold, italic, underline, lists, link) suits a chat
// message; "full" is the word-processor set for an email: styles, fonts,
// sizes, colours, highlight, alignment, indent, quote, rule, tables, clear
// formatting, undo and redo.
//
// A ref exposes insertContent/focus so a caller outside the editor (an
// emoji picker button living in the composer's own icon row, not inside
// this component) can still put text into it — Tiptap owns its DOM, so
// there is no other way in from outside.
export const RichTextEditor = forwardRef(({
  value, onChange, placeholder, onSubmitEditor, showToolbar = true, autoFocus = false, toolbar = "basic", onPasteFiles,
}, ref) => {
  // A ref, not a plain closure over the prop — editorProps.handleKeyDown is
  // captured once when Tiptap builds the view, and onSubmitEditor is a fresh
  // arrow function on every parent render (it closes over the latest
  // composeBody/sending state), so calling the prop directly here would
  // permanently invoke whatever it was on the very first render.
  const onSubmitRef = useRef(onSubmitEditor);
  onSubmitRef.current = onSubmitEditor;
  // Same reason as onSubmitRef: handlePaste is captured once by Tiptap.
  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;
  // Read when the editor redraws, so a placeholder that changes (chat's
  // "press Enter to send" once a picture is attached) is shown.
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const full = toolbar === "full";

  const editor = useEditor({
    extensions: [
      // StarterKit 3 bundles its own Link and Underline; those are switched
      // off so the configured ones below are the only copies (two of the
      // same name is a Tiptap warning and an unpredictable winner).
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: () => placeholderRef.current || "Type your response here..." }),
      ...(full
        ? [
            TextStyle,
            Color,
            FontFamily,
            FontSize,
            Highlight.configure({ multicolor: true }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            // Pictures inside the message (Mail): kept in the body as data: URIs.
            Image.configure({ inline: false, allowBase64: true, HTMLAttributes: { style: "max-width:100%;height:auto;" } }),
            TableKit.configure({
              table: { resizable: false, HTMLAttributes: { style: "border-collapse:collapse;width:100%;margin:8px 0;" } },
              tableCell: { HTMLAttributes: { style: CELL_STYLE } },
              tableHeader: { HTMLAttributes: { style: `${CELL_STYLE}background:#f3f4f7;font-weight:600;text-align:left;` } },
            }),
          ]
        : []),
    ],
    content: value || "",
    // "end" puts the cursor after any draft rather than before it.
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: { class: "rte-prose" },
      // A pasted picture or file goes to the caller (chat attaches it) rather
      // than being dropped: the editor has no image node, so a pasted
      // screenshot used to vanish without a word. Text pastes as usual.
      handlePaste: (_view, event) => {
        if (!onPasteFilesRef.current) return false;
        const data = event.clipboardData;
        const files = data?.files?.length
          ? Array.from(data.files)
          : Array.from(data?.items || []).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
        if (files.length === 0) return false;
        event.preventDefault();
        onPasteFilesRef.current(files);
        return true;
      },
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

  // The toolbar's pressed states and picker values, re-read on every change
  // of selection. Tiptap 3 does not re-render on each transaction by itself.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const heading = [1, 2, 3].find((level) => e.isActive("heading", { level }));
      const textStyle = full ? e.getAttributes("textStyle") : {};
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        bulletList: e.isActive("bulletList"),
        orderedList: e.isActive("orderedList"),
        blockquote: e.isActive("blockquote"),
        link: e.isActive("link"),
        table: full && e.isActive("table"),
        block: heading ? String(heading) : "p",
        fontFamily: textStyle.fontFamily || "",
        fontSize: textStyle.fontSize || "",
        color: textStyle.color || "",
        highlight: full ? e.getAttributes("highlight").color || "" : "",
        align: full ? ["center", "right", "justify"].find((a) => e.isActive({ textAlign: a })) || "left" : "left",
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        canSink: e.can().sinkListItem("listItem"),
        canLift: e.can().liftListItem("listItem"),
      };
    },
  });

  // The caller clears `value` back to "" after a successful send — Tiptap
  // otherwise keeps whatever was last typed, since it owns its own state.
  useEffect(() => {
    if (editor && value === "" && !editor.isEmpty) editor.commands.clearContent();
  }, [value, editor]);

  useImperativeHandle(ref, () => ({
    insertContent: (text) => editor?.chain().focus().insertContent(text).run(),
    insertImage: (src, alt = "") => editor?.chain().focus().setImage({ src, alt }).run(),
    focus: () => editor?.chain().focus().run(),
  }), [editor]);

  if (!editor || !state) return null;

  const setLink = async () => {
    const previous = editor.getAttributes("link").href;
    const url = await promptDialog({ body: "Link URL", defaultValue: previous || "https://" });
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const c = () => editor.chain().focus();

  const setBlock = (v) => {
    if (v === "p") c().setParagraph().run();
    else c().setHeading({ level: Number(v) }).run();
  };

  const basicButtons = (
    <>
      <ToolbarButton label="Bold (Ctrl+B)" active={state.bold} onClick={() => c().toggleBold().run()}>
        {full ? <I icon={ic_format_bold} /> : <strong>{"B"}</strong>}
      </ToolbarButton>
      <ToolbarButton label="Italic (Ctrl+I)" active={state.italic} onClick={() => c().toggleItalic().run()}>
        {full ? <I icon={ic_format_italic} /> : <em>{"I"}</em>}
      </ToolbarButton>
      <ToolbarButton label="Underline (Ctrl+U)" active={state.underline} onClick={() => c().toggleUnderline().run()}>
        {full ? <I icon={ic_format_underlined} /> : <u>{"U"}</u>}
      </ToolbarButton>
    </>
  );

  return (
    <div className={`rte${showToolbar ? "" : " rte-compact"}${full ? " rte-full" : ""}`}>
      {showToolbar && !full ? (
        <div className="rte-toolbar">
          {basicButtons}
          <span className="rte-sep" />
          <ToolbarButton label="Bulleted list" active={state.bulletList} onClick={() => c().toggleBulletList().run()}>
            {"• List"}
          </ToolbarButton>
          <ToolbarButton label="Numbered list" active={state.orderedList} onClick={() => c().toggleOrderedList().run()}>
            {"1. List"}
          </ToolbarButton>
          <span className="rte-sep" />
          <ToolbarButton label="Link" active={state.link} onClick={setLink}>
            {"Link"}
          </ToolbarButton>
        </div>
      ) : null}

      {showToolbar && full ? (
        <div className="rte-toolbar rte-toolbar-full" role="toolbar" aria-label="Formatting">
          <span className="rte-group">
            <ToolbarButton label="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => c().undo().run()}><I icon={ic_undo} /></ToolbarButton>
            <ToolbarButton label="Redo (Ctrl+Y)" disabled={!state.canRedo} onClick={() => c().redo().run()}><I icon={ic_redo} /></ToolbarButton>
          </span>
          <span className="rte-group rte-group-picks">
            <span className="rte-pick rte-pick-style">
              <Select className="select rte-select" value={state.block} onChange={setBlock} options={STYLE_OPTIONS} />
            </span>
            <span className="rte-pick rte-pick-font">
              <Select
                className="select rte-select"
                value={state.fontFamily}
                onChange={(v) => (v ? c().setFontFamily(v).run() : c().unsetFontFamily().run())}
                options={FONT_OPTIONS}
              />
            </span>
            <span className="rte-pick rte-pick-size">
              <Select
                className="select rte-select"
                value={state.fontSize}
                onChange={(v) => (v ? c().setFontSize(v).run() : c().unsetFontSize().run())}
                options={SIZE_OPTIONS}
              />
            </span>
          </span>
          <span className="rte-group">
            {basicButtons}
            <ToolbarButton label="Strikethrough" active={state.strike} onClick={() => c().toggleStrike().run()}><I icon={ic_format_strikethrough} /></ToolbarButton>
            <ColourMenu
              label="Text colour"
              icon={ic_format_color_text}
              colours={TEXT_COLOURS}
              current={state.color}
              bar="#000000"
              onPick={(col) => c().setColor(col).run()}
              onClear={() => c().unsetColor().run()}
              clearLabel="Automatic"
            />
            <ColourMenu
              label="Highlight"
              icon={ic_border_color}
              colours={HIGHLIGHTS}
              current={state.highlight}
              bar="#fff59d"
              onPick={(col) => c().setHighlight({ color: col }).run()}
              onClear={() => c().unsetHighlight().run()}
              clearLabel="No highlight"
            />
          </span>
          <span className="rte-group">
            <ToolbarButton label="Align left" active={state.align === "left"} onClick={() => c().setTextAlign("left").run()}><I icon={ic_format_align_left} /></ToolbarButton>
            <ToolbarButton label="Centre" active={state.align === "center"} onClick={() => c().setTextAlign("center").run()}><I icon={ic_format_align_center} /></ToolbarButton>
            <ToolbarButton label="Align right" active={state.align === "right"} onClick={() => c().setTextAlign("right").run()}><I icon={ic_format_align_right} /></ToolbarButton>
            <ToolbarButton label="Justify" active={state.align === "justify"} onClick={() => c().setTextAlign("justify").run()}><I icon={ic_format_align_justify} /></ToolbarButton>
          </span>
          <span className="rte-group">
            <ToolbarButton label="Bulleted list" active={state.bulletList} onClick={() => c().toggleBulletList().run()}><I icon={ic_format_list_bulleted} /></ToolbarButton>
            <ToolbarButton label="Numbered list" active={state.orderedList} onClick={() => c().toggleOrderedList().run()}><I icon={ic_format_list_numbered} /></ToolbarButton>
            <ToolbarButton label="Decrease indent" disabled={!state.canLift} onClick={() => c().liftListItem("listItem").run()}><I icon={ic_format_indent_decrease} /></ToolbarButton>
            <ToolbarButton label="Increase indent" disabled={!state.canSink} onClick={() => c().sinkListItem("listItem").run()}><I icon={ic_format_indent_increase} /></ToolbarButton>
          </span>
          <span className="rte-group">
            <ToolbarButton label="Quote" active={state.blockquote} onClick={() => c().toggleBlockquote().run()}><I icon={ic_format_quote} /></ToolbarButton>
            <ToolbarButton label="Horizontal line" onClick={() => c().setHorizontalRule().run()}><I icon={ic_horizontal_rule} /></ToolbarButton>
            <TableMenu editor={editor} inTable={state.table} />
            <ToolbarButton label="Link" active={state.link} onClick={setLink}><I icon={ic_insert_link} /></ToolbarButton>
            <ToolbarButton label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()}><I icon={ic_format_clear} /></ToolbarButton>
          </span>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
});

RichTextEditor.displayName = "RichTextEditor";

export default RichTextEditor;
