import { createHash } from "node:crypto";

export function canonicalizeQueueCreateBusinessRequest(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Queue create request must be an object.");
  }

  const businessRequest = { ...(input as Record<string, unknown>) };
  delete businessRequest.createOperationId;
  delete businessRequest.createRequestSha256;
  return JSON.stringify(sortJsonValue(businessRequest));
}

export function calculateQueueCreateRequestSha256(input: unknown): string {
  return createHash("sha256")
    .update(canonicalizeQueueCreateBusinessRequest(input), "utf8")
    .digest("hex");
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => typeof entry !== "undefined")
      .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  );
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] < rightPoints[index] ? -1 : 1;
    }
  }
  return leftPoints.length - rightPoints.length;
}
