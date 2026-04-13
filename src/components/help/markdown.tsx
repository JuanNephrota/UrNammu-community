"use client";

import React from "react";

/**
 * Minimal markdown renderer for in-app help content. Handles the subset used
 * in docs/help/*.md: H1, H2, paragraphs, unordered lists, **bold**, `code`,
 * and [link text](url). Anything outside that subset renders as plain text.
 *
 * Intentionally tiny — no external dependency, predictable output, easy to
 * style consistently with the dark theme.
 */

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  // Tokenize on **bold**, `code`, [text](url) using a single split regex.
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return tokens.filter(Boolean).map((token, i) => {
    const key = `${keyBase}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(token)) {
      return (
        <strong key={key} className="font-semibold text-[var(--text-primary)]">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (/^`[^`]+`$/.test(token)) {
      return (
        <code
          key={key}
          className="rounded bg-[var(--bg-base)] px-1 py-0.5 text-[0.85em] font-mono text-[var(--accent)]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={key}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <React.Fragment key={key}>{token}</React.Fragment>;
  });
}

export function HelpMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let paragraphBuffer: string[] = [];

  function flushList() {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul
        key={`ul-${blocks.length}`}
        className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--text-secondary)]"
      >
        {listBuffer.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li-${blocks.length}-${idx}`)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(" ");
    blocks.push(
      <p
        key={`p-${blocks.length}`}
        className="my-2.5 text-sm leading-relaxed text-[var(--text-secondary)]"
      >
        {renderInline(text, `p-${blocks.length}`)}
      </p>
    );
    paragraphBuffer = [];
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("# ")) {
      flushList();
      flushParagraph();
      blocks.push(
        <h1
          key={`h1-${blocks.length}`}
          className="mb-3 mt-1 text-lg font-semibold text-[var(--text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {renderInline(line.slice(2), `h1-${blocks.length}`)}
        </h1>
      );
    } else if (line.startsWith("## ")) {
      flushList();
      flushParagraph();
      blocks.push(
        <h2
          key={`h2-${blocks.length}`}
          className="mb-2 mt-5 text-[13px] font-semibold uppercase tracking-wider text-[var(--text-faint)]"
        >
          {renderInline(line.slice(3), `h2-${blocks.length}`)}
        </h2>
      );
    } else if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      listBuffer.push(line.replace(/^[-*]\s+/, ""));
    } else if (line.trim() === "") {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraphBuffer.push(line);
    }
  }
  flushList();
  flushParagraph();

  return <div>{blocks}</div>;
}
