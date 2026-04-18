declare module "js-yaml" {
  export function load(input: string): unknown;
  export function dump(
    input: unknown,
    options?: { lineWidth?: number; noRefs?: boolean; sortKeys?: boolean },
  ): string;
}
