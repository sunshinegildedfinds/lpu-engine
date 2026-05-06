import { NextResponse } from "next/server";

type SignRequest = {
  storagePath?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SignRequest;
    const storagePath =
      typeof body?.storagePath === "string" ? body.storagePath.trim() : "";

    if (!storagePath) {
      return NextResponse.json(
        { error: "Missing required storagePath." },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const bucketName =
      process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim() ||
      "lpu-generator-images";

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Storage signing is not configured." },
        { status: 500 }
      );
    }

    const encodedPath = storagePath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const signEndpoint = `${supabaseUrl}/storage/v1/object/sign/${bucketName}/${encodedPath}`;
    const signResponse = await fetch(signEndpoint, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 60 * 30 }),
      cache: "no-store",
    });

    if (!signResponse.ok) {
      const text = await signResponse.text();
      return NextResponse.json(
        { error: `Unable to create signed URL: ${signResponse.status} ${text}` },
        { status: 502 }
      );
    }

    const signedPayload = (await signResponse.json()) as {
      signedURL?: string;
      signedUrl?: string;
    };
    const relativeSigned =
      typeof signedPayload?.signedURL === "string"
        ? signedPayload.signedURL
        : typeof signedPayload?.signedUrl === "string"
          ? signedPayload.signedUrl
          : "";

    if (!relativeSigned) {
      return NextResponse.json(
        { error: "Signed URL response missing signedURL." },
        { status: 502 }
      );
    }

    const signedUrl = relativeSigned.startsWith("http")
      ? relativeSigned
      : `${supabaseUrl}/storage/v1${relativeSigned}`;

    return NextResponse.json({ signedUrl });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sign storage image.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
