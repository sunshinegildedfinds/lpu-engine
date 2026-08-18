import "server-only";

import { randomUUID } from "node:crypto";

export type LpuDeploymentEnvironment = "production" | "staging";

export class LpuDeploymentEnvironmentError extends Error {
  constructor(value: string | undefined) {
    super(
      value === undefined
        ? "LPU_DEPLOYMENT_ENV is required and must be exactly staging or production."
        : "LPU_DEPLOYMENT_ENV must be exactly staging or production."
    );
    this.name = "LpuDeploymentEnvironmentError";
  }
}

const STAGING_TITLE_PREFIX = "[STAGING TEST]";
const DEFAULT_STAGING_TTL_HOURS = 24;

export function resolveDeploymentEnvironment(): LpuDeploymentEnvironment {
  const configured = process.env.LPU_DEPLOYMENT_ENV;
  if (configured === "staging" || configured === "production") {
    return configured;
  }

  throw new LpuDeploymentEnvironmentError(configured);
}

export function getLpuDeploymentEnvironment(): LpuDeploymentEnvironment {
  return resolveDeploymentEnvironment();
}

export function isStagingDeployment(): boolean {
  return getLpuDeploymentEnvironment() === "staging";
}

export function getStagingListingMetadata(now = new Date()): {
  environment: "staging";
  testRunId: string;
  expiresAt: string;
} {
  const configuredTestRunId = process.env.LPU_STAGING_TEST_RUN_ID?.trim();
  const ttlHours = parsePositiveInteger(
    process.env.LPU_STAGING_TTL_HOURS,
    DEFAULT_STAGING_TTL_HOURS
  );

  return {
    environment: "staging",
    testRunId: isExactUuid(configuredTestRunId) ? configuredTestRunId : randomUUID(),
    expiresAt: new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
  };
}

export function prefixStagingTitle(title: string | null | undefined): string {
  const normalized = title?.trim() ?? "";
  if (normalized.startsWith(STAGING_TITLE_PREFIX)) return normalized;
  return `${STAGING_TITLE_PREFIX}${normalized ? ` ${normalized}` : " Untitled listing"}`;
}

export function isExactUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
