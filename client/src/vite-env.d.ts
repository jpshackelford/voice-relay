/// <reference types="vite/client" />

// Declare raw imports for markdown files
declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '@docs/*.md?raw' {
  const content: string;
  export default content;
}
