import type { Child } from "hono/jsx";

interface CodeBlockProps {
  code: string;
}

export function CodeBlock({ code }: CodeBlockProps) {
  return (
    <div class="panel">
      <pre class="code">{code}</pre>
    </div>
  );
}

interface DocsSectionProps {
  title: string;
  children: Child;
}

export function DocsSection({ title, children }: DocsSectionProps) {
  return (
    <>
      <h2 class="h3">{title}</h2>
      {children}
    </>
  );
}
