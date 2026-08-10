/**
 * Server-only OpenAI model selection.
 *
 * These are intentionally not NEXT_PUBLIC variables: browser clients cannot
 * select a model or redirect a core listing-generation request.  Core LP-U
 * generation is distinct from the deprecated public-web-comps endpoint.
 */
export const DEFAULT_LPU_OPENAI_GENERATION_MODEL = "gpt-5.6-sol";
export const DEFAULT_LPU_OPENAI_WEB_COMPS_MODEL = "gpt-5.6-terra";

export class LpuOpenAIModelConfigurationError extends Error {}

function configuredServerModel(
  value: string | undefined,
  fallback: string,
  expected: string,
  variableName: string
): string {
  const configured = value?.trim();
  if (!configured) return fallback;
  if (configured !== expected) {
    throw new LpuOpenAIModelConfigurationError(
      `${variableName} is not an approved server model.`
    );
  }
  return configured;
}

/** Core two-stage LP-U generation and all of its repairs/revisions. */
export function getLpuOpenAIGenerationModel(): string {
  return configuredServerModel(
    process.env.LPU_OPENAI_GENERATION_MODEL,
    DEFAULT_LPU_OPENAI_GENERATION_MODEL,
    DEFAULT_LPU_OPENAI_GENERATION_MODEL,
    "LPU_OPENAI_GENERATION_MODEL"
  );
}

/** Deprecated web-comps stays independently configured and server-only. */
export function getLpuOpenAIWebCompsModel(): string {
  return configuredServerModel(
    process.env.LPU_OPENAI_WEB_COMPS_MODEL,
    DEFAULT_LPU_OPENAI_WEB_COMPS_MODEL,
    DEFAULT_LPU_OPENAI_WEB_COMPS_MODEL,
    "LPU_OPENAI_WEB_COMPS_MODEL"
  );
}
