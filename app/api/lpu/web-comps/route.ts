import OpenAI from "openai";
import { NextResponse } from "next/server";
import { isStagingDeployment } from "@/lib/lpu/deploymentEnv";
import { getLpuOpenAIWebCompsModel } from "@/lib/lpu/openaiModels";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  WEB_COMPS_RESPONSE_SCHEMA,
  buildWebCompsPrompt,
  createEmptyWebCompsResult,
  parseWebCompsModelJson,
  parseWebCompsRequestBody,
} from "@/lib/lpu/webComps";

export const runtime = "nodejs";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment variables.");
  }

  return new OpenAI({ apiKey });
}

function extractWebSearchSourceUrls(response: unknown): string[] {
  if (!response || typeof response !== "object") return [];

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return [];

  const urls = new Set<string>();

  for (const item of output) {
    if (!item || typeof item !== "object") continue;

    const action = (item as { action?: unknown }).action;
    if (!action || typeof action !== "object") continue;

    const actionSource = action as {
      sources?: Array<{ url?: unknown }>;
      url?: unknown;
    };

    if (typeof actionSource.url === "string" && actionSource.url.trim()) {
      urls.add(actionSource.url.trim());
    }

    if (Array.isArray(actionSource.sources)) {
      for (const source of actionSource.sources) {
        if (typeof source.url === "string" && source.url.trim()) {
          urls.add(source.url.trim());
        }
      }
    }
  }

  return [...urls];
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (isStagingDeployment()) {
    try {
      await requireQueueOwnerSession();
    } catch (error) {
      if (error instanceof QueueAuthError) {
        return jsonError("Staging web comps requires Queue sign-in. Use /lpu-v2 to sign in.", 401);
      }
      return jsonError("Unable to verify staging access.", 500);
    }
  }

  let parsedBody;

  try {
    parsedBody = parseWebCompsRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Invalid web comps request.",
      400
    );
  }

  try {
    const openai = getOpenAIClient();
    const response = await openai.responses.create(
      {
        model: getLpuOpenAIWebCompsModel(),
        instructions:
          "You are a careful resale pricing research assistant. Use only public eBay evidence from the web_search tool. Return structured JSON only. Do not invent sold comp data.",
        tools: [
          {
            type: "web_search",
            filters: {
              allowed_domains: ["ebay.com"],
            },
            search_context_size: "medium",
          },
        ],
        include: ["web_search_call.action.sources"],
        text: {
          format: {
            type: "json_schema",
            name: "public_ebay_web_comps",
            strict: true,
            schema: WEB_COMPS_RESPONSE_SCHEMA,
          },
        },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildWebCompsPrompt(parsedBody),
              },
            ],
          },
        ],
      },
      {
        signal: AbortSignal.timeout(60000),
      }
    );

    const rawResult = response.output_text?.trim();
    const result = rawResult
      ? parseWebCompsModelJson(rawResult, parsedBody)
      : createEmptyWebCompsResult();

    return NextResponse.json({
      ...result,
      metadata: {
        webSearchSourceUrls: extractWebSearchSourceUrls(response),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "OpenAI web comps request failed.";

    if (message.toLowerCase().includes("abort")) {
      return jsonError("Public web comps search timed out.", 504);
    }

    return jsonError(message, 502);
  }
}
