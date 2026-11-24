export interface DedupeElement {
  html: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DedupePage {
  defs: string;
  elements: DedupeElement[];
  [key: string]: unknown;
}
export interface DedupedPage {
  definitionIds: string[];
  elements: DedupeElement[];
  [key: string]: unknown;
}
export function dedupeVectorPages(input: Record<string, DedupePage>): {
  pages: Record<string, DedupedPage>;
  definitions: Record<string, string>;
};
