import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

// Every Monarch tokenizer Monaco ships, and nothing else. The full
// `monaco-editor` entry point would also pull in the worker-backed language
// *services* — TypeScript, JSON, CSS and HTML IntelliSense, each with its own
// worker bundle — which exist to help someone writing code. Nobody writes here
// (`readOnly`), so highlighting is the whole of what this viewer needs, and
// this import is a fraction of the size.
import "monaco-editor/basic-languages/monaco.contribution";

// Monaco resolves its workers through this global rather than a bundler
// import, so Vite needs the `?worker` above to know one exists at all. Only
// the base editor worker is ever asked for, given the import list above.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/**
 * Two themes that paint no background of their own.
 *
 * The app's colours are `oklch` custom properties on `:root`, and a Monaco
 * theme takes literal hex — so any palette written here would be a second,
 * silently drifting copy of the design tokens. Making the editor transparent
 * instead lets the panel behind it supply every surface colour, which means
 * there is nothing to keep in step. Only the syntax colours come from Monaco,
 * inherited wholesale from its own `vs`/`vs-dark`.
 */
const TRANSPARENT_SURFACES = {
  "editor.background": "#00000000",
  "editorGutter.background": "#00000000",
  "editor.lineHighlightBackground": "#00000000",
  "editor.lineHighlightBorder": "#00000000",
  "editorLineNumber.foreground": "#8a8a8a",
  "editorLineNumber.activeForeground": "#8a8a8a",
  // Monaco draws its own scrollbars rather than the browser's, so the app's
  // `--scrollbar-thumb` cannot reach them. These are the same translucent
  // greys expressed as hex-with-alpha, over no track at all.
  "scrollbar.shadow": "#00000000",
  "scrollbarSlider.background": "#8a8a8a40",
  "scrollbarSlider.hoverBackground": "#8a8a8a66",
  "scrollbarSlider.activeBackground": "#8a8a8a80",
} as const;

/** Matches the app's `::-webkit-scrollbar` width, since the two sit on the same page. */
export const MONACO_SCROLLBAR_SIZE = 8;

export const MONACO_LIGHT_THEME = "skillset-light";
export const MONACO_DARK_THEME = "skillset-dark";

let themesDefined = false;

/** Registers the two themes above. Idempotent — Monaco keeps them globally, not per editor. */
export function defineMonacoThemes(): void {
  if (themesDefined) return;

  monaco.editor.defineTheme(MONACO_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: { ...TRANSPARENT_SURFACES },
  });
  monaco.editor.defineTheme(MONACO_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: { ...TRANSPARENT_SURFACES },
  });

  themesDefined = true;
}

/**
 * The Monaco language id to highlight a file as, from its path.
 *
 * @remarks
 * Answered out of Monaco's own language registry rather than a table of our
 * own: each registered language already declares the extensions and bare
 * filenames it covers, so asking it is both shorter and more complete than
 * restating a subset here. `artifactMediaType` (`@skillset/shared`) is
 * the separate question of whether a file is text *at all* — this one only
 * runs once the answer to that is yes.
 *
 * @param path - The file's path, relative to the Skill's root.
 * @returns A Monaco language id, or `"plaintext"` for anything unrecognised.
 * @example
 * ```ts
 * monacoLanguageForPath("references/java.md"); // "markdown"
 * monacoLanguageForPath("Dockerfile"); // "dockerfile"
 * ```
 */
export function monacoLanguageForPath(path: string): string {
  const fileName = (path.split("/").pop() ?? "").toLowerCase();
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot) : "";

  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((name: string) => name.toLowerCase() === fileName)) return language.id;
    if (extension && language.extensions?.some((candidate: string) => candidate.toLowerCase() === extension)) {
      return language.id;
    }
  }

  return "plaintext";
}

export { monaco };
