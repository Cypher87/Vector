import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceFile = resolve(process.argv[2] ?? 'vendor-tar1090/html/markers.js');
const outputFile = resolve(process.argv[3] ?? 'src/map/tar1090-icons.json');
const source = await readFile(sourceFile, 'utf8');

function objectLiteralAfter(marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Marker not found: ${marker}`);

  const start = source.indexOf('{', markerIndex);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`Object is not closed: ${marker}`);
}

const evaluate = (literal, parameters = [], values = []) =>
  Function(...parameters, `"use strict"; return (${literal});`)(...values);

const shapes = evaluate(objectLiteralAfter('let shapes ='));
const typeDesignators = evaluate(objectLiteralAfter('let TypeDesignatorIcons ='), ['_ulac'], [['cessna', 0.92]]);
const typeDescriptions = evaluate(objectLiteralAfter('let TypeDescriptionIcons ='));
const categories = evaluate(objectLiteralAfter('let CategoryIcons ='), ['_ulac'], [['cessna', 0.92]]);

const compactShapes = Object.fromEntries(Object.entries(shapes).map(([name, shape]) => [name, {
  accent: shape.accent,
  accentMult: shape.accentMult,
  h: shape.h,
  noAspect: shape.noAspect,
  path: shape.path,
  strokeScale: shape.strokeScale,
  svg: shape.svg,
  transform: shape.transform,
  viewBox: shape.viewBox,
  w: shape.w,
}]));

await writeFile(outputFile, `${JSON.stringify({
  source: 'https://github.com/wiedehopf/tar1090/blob/master/html/markers.js',
  license: 'GPL-2.0-or-later',
  shapes: compactShapes,
  typeDesignators,
  typeDescriptions,
  categories,
}, null, 2)}\n`);

console.log(`Wrote ${Object.keys(compactShapes).length} shapes and ${Object.keys(typeDesignators).length} type mappings to ${outputFile}`);
