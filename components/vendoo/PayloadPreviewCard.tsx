import type { VendooExtensionPayload } from "@/lib/vendoo/extensionPayload";

type PayloadPreviewCardProps = {
  payload: VendooExtensionPayload;
};

export function PayloadPreviewCard(props: PayloadPreviewCardProps) {
  const { payload } = props;

  return (
    <div className="rounded-xl bg-zinc-100 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Payload preview
      </div>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-zinc-800">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}
