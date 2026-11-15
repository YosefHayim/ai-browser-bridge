import type { Child } from "hono/jsx";

interface CodeBlockProps {
  code: string;
}

export const CodeBlock = ({ code }: CodeBlockProps) => (
  <div class="panel">
    <pre class="code">{code}</pre>
  </div>
);

interface DocsSectionProps {
  title: string;
  children: Child;
}

export const DocsSection = ({ title, children }: DocsSectionProps) => (
  <>
    <h2 class="h3">{title}</h2>
    {children}
  </>
);
