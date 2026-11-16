// Driver for the markdown-render-speed-02 entry.
//
// Reads every case from the input directory, renders each one alone with
// parse() from parse.js, and writes the HTML strings (in case order) to
// the output directory. Each case is rendered independently: no state is
// shared between cases, so the output is deterministic for a given input.
// Outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in
// for /input and /output.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

type Case = { id: string; markdown: string };

const INPUT_ENV = 'MAKEFUN_INPUT_DIR';
const OUTPUT_ENV = 'MAKEFUN_OUTPUT_DIR';
const DEFAULT_INPUT = '/input';
const DEFAULT_OUTPUT = '/output';
const CASES_FILE = 'cases.json';
const HTML_FILE = 'html.json';

function readCases(dir: string): Case[] {
  const raw = readFileSync(join(dir, CASES_FILE), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${CASES_FILE} is not an array`);
  return parsed as Case[];
}

function renderAll(cases: Case[]): string[] {
  const html: string[] = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) {
    html[i] = parse(cases[i].markdown);
  }
  return html;
}

function writeHtml(dir: string, html: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, HTML_FILE), JSON.stringify(html));
}

function main(): void {
  const inputDir = process.env[INPUT_ENV] ?? DEFAULT_INPUT;
  const outputDir = process.env[OUTPUT_ENV] ?? DEFAULT_OUTPUT;
  const cases = readCases(inputDir);
  const html = renderAll(cases);
  writeHtml(outputDir, html);
}

main();
