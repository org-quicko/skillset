import Editor, { type OnMount } from "@monaco-editor/react";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Spinner } from "@/components/ui/spinner";
import {
  defineMonacoThemes,
  monaco,
  monacoLanguageForPath,
  MONACO_DARK_THEME,
  MONACO_LIGHT_THEME,
  MONACO_SCROLLBAR_SIZE,
} from "@/lib/monaco";
import { loader } from "@monaco-editor/react";

// `@monaco-editor/react` fetches Monaco from a CDN unless handed an instance.
// This Registry is self-hosted and may sit on a network with no route out, so
// the bundled copy is the only one it can be sure of.
loader.config({ monaco });
defineMonacoThemes();

/** Whether the OS is asking for dark, for the `system` theme setting. */
function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * A read-only Monaco editor, highlighted for the file's own language.
 *
 * @remarks
 * Monaco and not a lighter highlighter because a Skill's folder holds
 * whatever its author wrote — shell, Python, YAML, TypeScript, JSON, plain
 * prose — and Monaco already knows every one of them, plus the line numbers,
 * folding, and find-in-file that make a long reference file navigable. Only
 * its tokenizers are bundled, never its language services (see `lib/monaco`),
 * because nothing here is editable.
 *
 * This module is the lazy-loading boundary for all of that: it is imported
 * through `React.lazy` so the catalog and every other page load without
 * Monaco in their bundle, and a visitor who never opens a file never fetches
 * it.
 *
 * @param path - The file's path, which decides the language to highlight as
 * and keys the remount between files. Two readings of the same file share a
 * path, and so share the editor.
 * @param value - The text to show: the file's own, or a fragment of it.
 * @param language - A Monaco language id to highlight as instead of the one
 * the path implies, for a fragment whose language its file's does not name —
 * a `SKILL.md`'s YAML frontmatter, say.
 * @param fitContent - Sizes the editor to its full text height rather than to
 * its container — never scrolling on its own — for an editor shown inline
 * among other content instead of filling a pane. Never give such an editor a
 * height below the one it reports: Monaco renders the text it was sized for
 * and will not wheel-scroll to the rest, so the overflow is simply lost.
 * @example
 * ```tsx
 * <CodeViewer path="references/java.md" value={source} />
 * <CodeViewer path="SKILL.md" value={frontmatter} language="yaml" fitContent />
 * ```
 */
export default function CodeViewer({
  path,
  value,
  language,
  fitContent = false,
}: {
  path: string;
  value: string;
  language?: string;
  fitContent?: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark" || (theme === "system" && prefersDark());
  // The height is kept beside the text it was measured for: one editor is
  // handed a whole file in one reading and a fragment of it in the next, and
  // Monaco reports the new height only once it has laid the new text out.
  // Pairing the two means a stale measurement is ignored rather than briefly
  // sizing a short fragment to the file it replaced.
  const [measured, setMeasured] = useState<{ value: string; height: number }>();
  const contentHeight = measured?.value === value ? measured.height : undefined;

  // Monaco fills the height it is given and never reports one, so an editor
  // that should be as tall as its text has to be told — and told again when
  // its text changes, or when wrapping changes at a new width.
  const trackContentHeight: OnMount = (editor) => {
    const sync = () => setMeasured({ value: editor.getValue(), height: editor.getContentHeight() });
    sync();
    editor.onDidContentSizeChange(sync);
  };

  return (
    <Editor
      // Remounting per file rather than swapping the model keeps the scroll
      // position and folding state of one file from bleeding into the next.
      // Within a file the key holds, so a caller that swaps between two
      // readings of it reuses this editor instead of building a second one.
      key={path}
      language={language ?? monacoLanguageForPath(path)}
      value={value}
      height={fitContent ? (contentHeight ?? 0) : "100%"}
      onMount={trackContentHeight}
      theme={isDark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME}
      loading={<Spinner className="size-5" />}
      options={{
        readOnly: true,
        // Read-only already refuses edits; this also hides the cursor and the
        // "cannot edit in read-only editor" toast a stray keystroke triggers.
        domReadOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        // The panel gives the editor a fixed height, so the editor must not
        // also try to size itself from its content.
        automaticLayout: true,
        fontSize: 12.5,
        lineHeight: 1.7,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: "none",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          verticalScrollbarSize: MONACO_SCROLLBAR_SIZE,
          horizontalScrollbarSize: MONACO_SCROLLBAR_SIZE,
          verticalSliderSize: MONACO_SCROLLBAR_SIZE,
          horizontalSliderSize: MONACO_SCROLLBAR_SIZE,
          // The gradient Monaco fades in at a scrolled edge is a second
          // border against the panel's own.
          useShadows: false,
          // Monaco consumes the wheel by default even with nothing of its own
          // left to scroll, which strands a reader whose pointer happens to
          // be over the editor when the scrolling to be done is the panel's.
          alwaysConsumeMouseWheel: false,
        },
        wordWrap: "on",
        // Prose wraps; code does not, and a Skill's folder holds both. Wrapping
        // everything is the kinder default for the documentation that dominates
        // a Skill, and the horizontal scrollbar stays for whatever overflows a
        // wrap point anyway.
        wrappingStrategy: "advanced",
        guides: { indentation: false },
        contextmenu: false,
        stickyScroll: { enabled: false },
      }}
    />
  );
}
