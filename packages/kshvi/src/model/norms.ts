import type { AssumptionPassport } from './assumptions';
import type { Quantity, VersionRef } from './types';

export type NumericNorm = Readonly<{
  id: string;
  value: Quantity;
  applicability: string;
  passport: AssumptionPassport;
  version: VersionRef;
}>;

export type ModelProfile = Readonly<{
  id: string;
  reducerVersion: number;
  norms: readonly NumericNorm[];
  passport: AssumptionPassport;
  formulaVersion: number;
}>;
