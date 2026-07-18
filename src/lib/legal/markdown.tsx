import React from "react";

/**
 * L2.7 - a small, dependency-free Markdown + frontmatter parser for the legal
 * publishing system. It renders to React nodes (never raw HTML strings), so all
 * text is auto-escaped by React and there is no injection surface. It supports
 * exactly the constructs used in the legal master documents: ATX headings,
 * paragraphs, ordered/unordered lists, GFM pipe tables, blockquote callouts,
 * horizontal rules, and inline bold / italic / code / links. Inline code that is
 * a `/legal/...` path is auto-linked so cross-references stay clickable.
 */

export type Frontmatter = Record<string, string | boolean | string[]>;

/** Parse a leading `---` YAML-ish frontmatter block (a constrained subset). */
export function parseFrontmatter(raw: string): { data: Frontmatter; content: string } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { data: {}, content: raw };
  let i = 1;
  const fm: string[] = [];
  while (i < lines.length && lines[i].trim() !== "---") {
    fm.push(lines[i]);
    i++;
  }
  if (i >= lines.length) return { data: {}, content: raw }; // no closing fence
  const content = lines.slice(i + 1).join("\n");
  const data: Frontmatter = {};
  for (const line of fm) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf(":");
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    let val = t.slice(idx + 1).trim();
    if (val === "") {
      data[key] = "";
    } else if (val === "true" || val === "false") {
      data[key] = val === "true";
    } else if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      data[key] = inner
        ? inner
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean)
        : [];
    } else {
      data[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return { data, content };
}

/** Estimate reading time in minutes (~200 wpm), from markdown or plain text. */
export function readingMinutes(text: string): number {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|-]/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .trim();
  const words = plain ? plain.split(/\s+/).length : 0;
  return Math.max(1, Math.round(words / 200));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type Heading = { id: string; text: string; level: number };

/** Extract headings (for the table of contents), ignoring inline markers. */
export function extractHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const text = m[2].trim().replace(/\*\*/g, "");
      out.push({ level: m[1].length, text, id: slugify(text) });
    }
  }
  return out;
}

// ---- inline ---------------------------------------------------------------

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let buf = "";
  let i = 0;
  let k = 0;
  const flush = () => {
    if (buf) {
      nodes.push(buf);
      buf = "";
    }
  };
  while (i < text.length) {
    const c = text[i];
    // inline code (highest precedence)
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        const code = text.slice(i + 1, end);
        if (/^\/legal\/[a-z-]+$/.test(code)) {
          nodes.push(
            <a key={`${keyPrefix}-${k++}`} href={code}>
              {code}
            </a>,
          );
        } else {
          nodes.push(<code key={`${keyPrefix}-${k++}`}>{code}</code>);
        }
        i = end + 1;
        continue;
      }
    }
    // bold
    if (c === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        nodes.push(
          <strong key={`${keyPrefix}-${k++}`}>
            {renderInline(text.slice(i + 2, end), `${keyPrefix}-b${k}`)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    // italic (single *), require a non-space right after the opener
    if (c === "*" && text[i + 1] && text[i + 1] !== " ") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        flush();
        nodes.push(
          <em key={`${keyPrefix}-${k++}`}>
            {renderInline(text.slice(i + 1, end), `${keyPrefix}-i${k}`)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }
    // link [text](url)
    if (c === "[") {
      const close = text.indexOf("]", i + 1);
      if (close !== -1 && text[close + 1] === "(") {
        const pclose = text.indexOf(")", close + 2);
        if (pclose !== -1) {
          flush();
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, pclose);
          nodes.push(
            <a key={`${keyPrefix}-${k++}`} href={url}>
              {renderInline(label, `${keyPrefix}-l${k}`)}
            </a>,
          );
          i = pclose + 1;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return nodes;
}

// ---- block ----------------------------------------------------------------

function isBlockStart(line: string): boolean {
  return (
    /^(#{1,6})\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim()) ||
    /^\|.*\|/.test(line)
  );
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes("-");
}

/** Render a Markdown string to React nodes. */
export function renderMarkdown(md: string, keyBase = "b"): React.ReactNode {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    // heading (### in the body → <h2>, shifting so the page <h1> is the title)
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(Math.max(h[1].length - 1, 2), 4);
      const text = h[2].trim();
      const id = slugify(text.replace(/\*\*/g, ""));
      const Tag = (level === 2 ? "h2" : level === 3 ? "h3" : "h4") as "h2" | "h3" | "h4";
      blocks.push(
        <Tag key={`${keyBase}-${key++}`} id={id}>
          {renderInline(text, `${keyBase}-h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }
    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`${keyBase}-${key++}`} />);
      i++;
      continue;
    }
    // blockquote (callout)
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={`${keyBase}-${key++}`}>
          {renderMarkdown(q.join("\n"), `${keyBase}-q${key}`)}
        </blockquote>,
      );
      continue;
    }
    // GFM table
    if (/^\|.*\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`${keyBase}-${key++}`} className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {header.map((c, ci) => (
                  <th key={ci}>{renderInline(c, `${keyBase}-th${key}-${ci}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{renderInline(c, `${keyBase}-td${key}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`${keyBase}-${key++}`}>
          {items.map((it, ix) => (
            <li key={ix}>{renderInline(it, `${keyBase}-ul${key}-${ix}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`${keyBase}-${key++}`}>
          {items.map((it, ix) => (
            <li key={ix}>{renderInline(it, `${keyBase}-ol${key}-${ix}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    // paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`${keyBase}-${key++}`}>{renderInline(para.join(" "), `${keyBase}-p${key}`)}</p>,
    );
  }
  return <>{blocks}</>;
}
