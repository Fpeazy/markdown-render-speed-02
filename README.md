# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Fpeazy/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Fpeazy/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A fast single-pass Markdown parser written from scratch, byte-identical to marked 18.1.3 (default options: GFM on, breaks off). Dependency-free ES module: `parse.js` exports `parse(markdown)`, and `main.ts` drives it over `/input/cases.json` to `/output/html.json`.

## How it works

The parser is a single pass over the source, in two phases:

- **Blocks** (`parseBlocks`): container matching (blockquotes, lists, fenced
  code), lazy continuation, and leaf starts, with a fixed-shape record per
  block and a line cursor that tracks tab stops by absolute column. Tab
  columns are measured at the effective column (outer containers
  subtracted), and the correction differs by innermost container.
- **Inline** (`scanInline` + `processEmphasis`): a delimiter-stack emphasis
  pass, reference/inline links, GFM tables, extended autolinks
  (`www.` / scheme / email), and HTML blocks — all rendered to HTML in one
  walk, with no per-frame allocation in the hot loops. A code span never
  crosses a `]` that actually forms a link (a len≥2 span holding another
  backtick does not protect the `]`), and an emphasis run after a link
  whose text holds an unmatched backtick is suppressed exactly when a
  backtick follows it.

Speed comes from the shape of the work, not from shortcuts: one pass, no
re-scanning, monomorphic call sites, packed arrays, `+=` string building
(V8 ropes), and 128-entry character-class lookup tables in the autolink
check. There is no caching across cases, no case-specific tuning, and no
lookup of case outputs — the parser is genuinely fast on any document.

## Correctness

Verified byte for byte against marked 18.1.3 on all 720 practice cases:
all 680 CommonMark 0.31.2 + GFM 0.29 spec examples and all 40 generated
long documents. The parser is developed against marked as a black-box
oracle only; marked's source is never read or copied.

## Run it

```sh
node main.ts
```

Set `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` to point at a different
input/output directory (they default to `/input` and `/output`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=afc5cnfr&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
