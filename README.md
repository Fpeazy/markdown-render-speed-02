# Fast single-pass Markdown parser

[![make.fun](https://make.fun/badge/competition/markdown-render-speed-02)](https://make.fun/bounty/markdown-render-speed-02)
[![make.fun entry](https://make.fun/badge/entry/markdown-render-speed-02)](https://make.fun/bounty/markdown-render-speed-02)
[![license](https://make.fun/badge/license/MIT)](https://make.fun/bounty/markdown-render-speed-02)

A dependency-free, single-pass CommonMark 0.31.2 + GFM 0.29 parser written
from scratch, producing byte-identical HTML to marked 18.1.3 (default
options) on the competition's 720 cases (680 spec examples + 40 generated
documents), while rendering noticeably faster than marked.

## How it works

- **Blocks**: a line-based container matcher (blockquotes and list items)
  with a visual-column line cursor. Tabs that are only partly consumed as
  indentation are expanded into spaces so the remainder stays in the
  content. Leaves: paragraphs, ATX/setext headings, fenced and indented
  code, HTML blocks (types 1–7), thematic breaks, lists (tight/loose,
  task-list checkboxes) and GFM tables.
- **Inline**: one scan builds text nodes plus a delimiter stack (emphasis,
  strikethrough) and a bracket stack (links/images). Emphasis is resolved
  with the CommonMark appendix-A algorithm — closers in order, nearest
  opener back, rule of three — and links resolve when a `]` is scanned,
  against link reference definitions collected from paragraph starts.
  Extended autolinks (`www.`, bare scheme, email) follow the GFM rules,
  including the single-flag parenthesis balance and trailing-punctuation
  trimming.
- **Entities**: named references (`&name;`) pass through literally;
  numeric references decode to a code point (invalid ones become U+FFFD)
  and the resulting character is escaped when it is special. Code spans
  are literal: `&` always becomes `&amp;`.

## Layout

- `parse.js` — the parser. `parse(markdown)` returns the HTML string.
  Dependency-free ES module.
- `main.ts` — the harness driver. Reads `$MAKEFUN_INPUT_DIR/cases.json`
  (default `/input`), writes `$MAKEFUN_OUTPUT_DIR/html.json`
  (default `/output`).

## Entry

Built for the [make.fun](https://make.fun) bounty
[markdown-render-speed-02](https://make.fun/bounty/markdown-render-speed-02)
— "Make Markdown rendering faster".
