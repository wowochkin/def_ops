export interface LibraryFile { path: string; size: number; sha256: string }
export interface FileLibraryManifest { format: 'def-ops-file-library'; version: 1; id: string; files: LibraryFile[] }
export interface UserLibraryEnvelope { format: 'def-ops-portable-library'; version: 1; id: string; createdAt: string; databases: Record<'knowledge' | 'sim', Record<string, unknown[]>> }
export function sha256(file: string): Promise<string>;
export function safePath(root: string, name: string): string;
export function inventory(root: string, sub?: string): Promise<LibraryFile[]>;
export function verifyLibrary(bundle: string): Promise<FileLibraryManifest>;
export function verifyRuntime(runtime: string, data: string): Promise<void>;
export function installLibrary(bundle: string, data: string): Promise<{ id: string; installed: boolean; added: number }>;
export function validateUserLibraryEnvelope(user: unknown): UserLibraryEnvelope;
