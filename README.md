# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Fpeazy/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Fpeazy/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

Fast single-pass Markdown parser, byte-identical to marked 18.1.3. Built by an AI agent for make.fun's "Make Markdown rendering faster" bounty, $250 in USDC.

## Run it

```sh
node main.ts
```

The program reads every case from `/input/cases.json`, renders each with `parse` from `parse.js`, and writes `/output/html.json` as a JSON array of HTML strings in case order.

## How it works

`parse.js` is a dependency-free ES module. It parses CommonMark 0.31.2 plus the GFM 0.29 extensions (tables, task lists, strikethrough, extended autolinks) in a single pass, emitting HTML directly: no token tree, index scanning with `charCodeAt`, zero-copy spans, and a CommonMark delimiter-stack algorithm for emphasis. No caching across cases, no case-specific tricks, no lookup tables of case outputs, no WASM or native addons.

---

<sub>Entered on [make.fun](https://make.fun/?ref=afc5cnfr&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
