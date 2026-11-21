export declare const CATEGORY_FILES: Readonly<Record<string, string>>;
export declare const REQUIRED_CATEGORIES: readonly string[];
export declare const ALLOWED_EFFECT_TYPES: readonly string[];

export type CatalogTemplate = Record<string, any>;
export type CatalogReport = Record<string, any>;
export type CatalogManifest = Record<string, any>;

export declare function mechanismFingerprint(template: CatalogTemplate): string;
export declare function rehearseTemplate(template: CatalogTemplate, facts: Record<string, unknown>): CatalogReport;
export declare function analyzeCatalog(input: {
  templates: CatalogTemplate[];
  sources?: Record<string, any>;
  manifest?: CatalogManifest | null;
  requireManifest?: boolean;
  requireMinimum?: number;
  requirePerCategory?: number;
}): CatalogReport;
export declare function buildManifest(input: {
  templates: CatalogTemplate[];
  rawFiles?: Record<string, string>;
  catalogVersion?: string;
}): CatalogManifest;
export declare function loadCatalog(catalogDirectory: string): Promise<{
  root: string;
  templates: CatalogTemplate[];
  rawFiles: Record<string, string>;
  sources: Record<string, any>;
  manifest: CatalogManifest | null;
}>;
