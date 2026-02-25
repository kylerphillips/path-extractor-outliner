import { optimize } from "svgo/lib/svgo.js";

if (typeof TextDecoder === "undefined") {
  (globalThis as any).TextDecoder = class TextDecoder {
    decode(bytes: Uint8Array): string {
      let out = "";
      for (let i = 0; i < bytes.length; ) {
        const b0 = bytes[i++];
        if (b0 < 0x80) { out += String.fromCharCode(b0); }
        else if ((b0 & 0xe0) === 0xc0) { const b1=bytes[i++]&0x3f; out+=String.fromCharCode(((b0&0x1f)<<6)|b1); }
        else if ((b0 & 0xf0) === 0xe0) { const b1=bytes[i++]&0x3f,b2=bytes[i++]&0x3f; out+=String.fromCharCode(((b0&0x0f)<<12)|(b1<<6)|b2); }
        else { const b1=bytes[i++]&0x3f,b2=bytes[i++]&0x3f,b3=bytes[i++]&0x3f; const cp=((b0&0x07)<<18)|(b1<<12)|(b2<<6)|b3,sc=cp-0x10000; out+=String.fromCharCode(0xd800+(sc>>10),0xdc00+(sc&0x3ff)); }
      }
      return out;
    }
  };
}

interface ExtractOptions {
  outlineStrokes: boolean;
  strokeAlignCenter: boolean;
  strokePreserveOriginal: boolean;
  flatten: boolean;
  precision: number;
  debugSvg: boolean;
}

figma.showUI(__html__, { width: 340, height: 520, themeColors: true });

figma.ui.onmessage = async (msg: { type: string; options?: ExtractOptions }) => {
  if (msg.type === "flatten-icon") {
    await flattenIconInPlace(msg.options?.precision ?? 3);
  } else if (msg.type === "extract") {
    await runExtraction(msg.options ?? defaultOptions());
  }
};

function defaultOptions(): ExtractOptions {
  return { outlineStrokes: true, strokeAlignCenter: true, strokePreserveOriginal: false, flatten: true, precision: 3, debugSvg: false };
}

// ── FLATTEN ICON — mutates original frame ────────────────────────────────────

async function flattenIconInPlace(precision: number): Promise<void> {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1 || selection[0].type !== "FRAME") {
    figma.ui.postMessage({ type: "error", message: "Select exactly one frame." });
    return;
  }

  const frame = selection[0] as FrameNode;
  const log: string[] = [];

  try {
    log.push(`Frame "${frame.name}" — ${frame.children.length} top-level children`);

    const groupCount = countGroups(frame);
    ungroupAll(frame);
    log.push(`Ungrouped: removed ${groupCount} group(s) → ${frame.children.length} children`);

    outlineStrokesDeep(frame, true, false, log);

    flattenToOne(frame);
    log.push(`Flattened to ${frame.children.length} node(s)`);

    figma.ui.postMessage({ type: "flatten-done", name: frame.name, log: log.join("\n") });
  } catch (err) {
    figma.ui.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      log: log.join("\n"),
    });
  }
}

// ── EXTRACT — works on a clone, returns path data ────────────────────────────

async function runExtraction(opts: ExtractOptions): Promise<void> {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1 || selection[0].type !== "FRAME") {
    figma.ui.postMessage({ type: "error", message: "Select exactly one frame." });
    return;
  }

  const frame = selection[0] as FrameNode;
  let clone: FrameNode | undefined;
  const log: string[] = [];

  try {
    clone = frame.clone();
    figma.currentPage.appendChild(clone);
    clone.x = frame.x + frame.width + 20;
    clone.y = frame.y;
    log.push(`Cloned "${frame.name}": ${clone.children.length} top-level children`);

    const groupCount = countGroups(clone);
    ungroupAll(clone);
    log.push(`Ungrouped: removed ${groupCount} group(s) → ${clone.children.length} children`);

    if (opts.outlineStrokes) {
      outlineStrokesDeep(clone, opts.strokeAlignCenter, opts.strokePreserveOriginal, log);
    }

    if (opts.flatten) {
      flattenToOne(clone);
      log.push(`Flattened to ${clone.children.length} child(ren)`);
    }

    const svgBytes = await clone.exportAsync({ format: "SVG" });
    const svgString = new TextDecoder().decode(svgBytes);
    log.push(`Exported SVG: ${svgString.length} chars`);

    if (opts.debugSvg) {
      figma.ui.postMessage({ type: "debug-svg", svg: svgString });
    }

    const result = optimize(svgString, {
      plugins: [{ name: "preset-default", params: { overrides: {
        cleanupNumericValues: { floatPrecision: opts.precision },
        convertPathData:      { floatPrecision: opts.precision },
      }}}],
    });

    const { d: optimizedPath, fillRule } = extractPathData(result.data);
    const fallback = extractPathData(svgString);
    const pathData = optimizedPath || fallback.d;
    const finalFillRule = optimizedPath ? fillRule : fallback.fillRule;

    const subPathCount = pathData ? pathData.split(/(?=[Mm])/).filter(Boolean).length : 0;
    log.push(`Paths: ${subPathCount} sub-path(s), fill-rule: ${finalFillRule}`);

    if (!pathData) throw new Error(`No path data found.\n\nRaw SVG:\n${svgString.slice(0, 600)}`);

    figma.ui.postMessage({ type: "ready", pathData, fillRule: finalFillRule, log: log.join("\n") });

  } catch (err) {
    figma.ui.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      log: log.join("\n"),
    });
  } finally {
    clone?.remove();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countNodes(node: BaseNode): number {
  let n = 1;
  if ("children" in node) for (const c of (node as ChildrenMixin).children) n += countNodes(c);
  return n;
}

function countGroups(node: BaseNode): number {
  let n = 0;
  if ("children" in node) {
    for (const c of (node as ChildrenMixin).children) {
      if (c.type === "GROUP") n++;
      n += countGroups(c);
    }
  }
  return n;
}

// ── Ungroup all groups recursively ────────────────────────────────────────────

function ungroupAll(frame: FrameNode): void {
  let safety = 500;
  while (safety-- > 0) {
    const group = findFirstGroup(frame);
    if (!group) break;
    const parent = group.parent as ChildrenMixin;
    for (const kid of [...group.children] as SceneNode[]) {
      parent.appendChild(kid);
    }
    // Figma auto-dissolves empty groups, so it may already be gone
    try { group.remove(); } catch (_) {}
  }
}

function findFirstGroup(node: BaseNode): GroupNode | null {
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (child.type === "GROUP") return child as GroupNode;
      const nested = findFirstGroup(child);
      if (nested) return nested;
    }
  }
  return null;
}

// ── Outline strokes ──────────────────────────────────────────────────────────
// For each node with strokes: call outlineStroke() to create a filled sibling,
// then clear strokes from the original. Never calls remove() — flattenToOne()
// merges everything afterward.

function outlineStrokesDeep(container: ChildrenMixin, alignCenter: boolean, preserveOrig: boolean, log: string[]): void {
  const children = [...container.children] as SceneNode[];
  log.push(`Outline: ${children.length} children to process`);

  for (const child of children) {
    if ("children" in child) {
      outlineStrokesDeep(child as ChildrenMixin, alignCenter, preserveOrig, log);
    }

    const node = child as any;
    const name: string = node.name || "?";
    const type: string = child.type;

    if (typeof node.outlineStroke !== "function") {
      log.push(`  [${type}] "${name}" — no outlineStroke, skip`);
      continue;
    }

    // strokes can be an array or figma.mixed (Symbol) for mixed properties
    const strokes = node.strokes;
    if (Array.isArray(strokes) && strokes.length === 0) {
      log.push(`  [${type}] "${name}" — 0 strokes, skip`);
      continue;
    }

    const strokeInfo = Array.isArray(strokes) ? `${strokes.length} stroke(s)` : "mixed";
    log.push(`  [${type}] "${name}" — ${strokeInfo}`);

    // Try setting CENTER alignment (separate from outline so a failure here
    // doesn't prevent the outline call)
    if (alignCenter) {
      try { node.strokeAlign = "CENTER"; } catch (e) {
        log.push(`    align→CENTER failed: ${e}`);
      }
    }

    try {
      const outlined = node.outlineStroke();
      if (outlined) {
        log.push(`    ✓ outlined → [${outlined.type}] "${outlined.name}"`);
        if (!preserveOrig) {
          // Clear both strokes and fills from the original — the outlined
          // sibling captures the stroke boundary. Keeping the original fill
          // (often white for icon interiors) breaks flatten by creating
          // conflicting paths that neither NONZERO nor EVENODD renders right.
          try { node.strokes = []; } catch (_) {}
          try { node.fills = []; } catch (_) {}
        }
      } else {
        log.push(`    ✗ outlineStroke() returned null`);
      }
    } catch (e) {
      log.push(`    ✗ outlineStroke() threw: ${e}`);
    }
  }
}

// ── Flatten all children into a single vector ─────────────────────────────────

function flattenToOne(frame: FrameNode): void {
  const all = [...frame.children] as SceneNode[];
  if (all.length === 0) return;
  if (all.length > 1) {
    figma.flatten(all, frame);
  } else if (all[0].type !== "VECTOR") {
    figma.flatten(all, frame);
  }
}

// ── Path extraction ───────────────────────────────────────────────────────────

function extractPathData(svg: string): { d: string; fillRule: string } {
  const paths: string[] = [];
  let fillRule = "nonzero";
  const pathRe = /<path\b[^>]*\/?>/g;
  const dRe    = /\bd="([^"]*)"/;
  const frRe   = /\bfill-rule="([^"]*)"/;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(svg)) !== null) {
    const fr = frRe.exec(m[0]);
    if (fr) fillRule = fr[1];
    const d = dRe.exec(m[0]);
    if (d && d[1].trim()) paths.push(d[1].trim());
  }
  return { d: paths.join(" "), fillRule };
}
