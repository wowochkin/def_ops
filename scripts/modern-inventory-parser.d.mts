export interface InventoryCell { text: string; header: boolean; rowspan: number; colspan: number; links: { text: string; href: string }[] }
export interface InventoryPage { tables: { index: number; headings: string[]; rows: InventoryCell[][] }[] }
export interface InventoryRecord { title: string; aliases: string[]; domain: string; section: string; role: string; modelUrl: string | null; table: number; row: number; catalogueStatus: 'listed' | 'prospective' }
export function clean(s: unknown): string;
export function normalizeModelName(s: string): string;
export function parseInventory(page: InventoryPage, domain?: string): { records: InventoryRecord[]; unresolved: {table: number; row?: number; reason: string}[]; skipped: {table: number; row?: number; reason: string}[] };
export function classifyEquipment(record: InventoryRecord): string;
