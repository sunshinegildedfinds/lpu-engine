import type { EbayDraftInput } from "@/lib/ebay/generateDraft";

type SendFeedbackState = {
  status: "idle" | "sent" | "failed";
  message: string;
};

type EbayDraftFormProps = {
  form: EbayDraftInput;
  onFieldChange: (key: keyof EbayDraftInput, value: string) => void;
  onSendPayload: () => void;
  isReadyToSend: boolean;
  sendFeedback: SendFeedbackState;
};

function DraftInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { label, value, onChange } = props;

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-zinc-800">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm"
      />
    </div>
  );
}

export function EbayDraftForm(props: EbayDraftFormProps) {
  const { form, onFieldChange, onSendPayload, isReadyToSend, sendFeedback } = props;

  return (
    <section className="grid gap-4">
      <DraftInput
        label="Brand"
        value={form.brand}
        onChange={(value) => onFieldChange("brand", value)}
      />

      <DraftInput
        label="Item Type"
        value={form.itemType}
        onChange={(value) => onFieldChange("itemType", value)}
      />

      <DraftInput
        label="Size"
        value={form.size}
        onChange={(value) => onFieldChange("size", value)}
      />

      <DraftInput
        label="Color"
        value={form.color}
        onChange={(value) => onFieldChange("color", value)}
      />

      <DraftInput
        label="Feature 1"
        value={form.feature1}
        onChange={(value) => onFieldChange("feature1", value)}
      />

      <DraftInput
        label="Feature 2"
        value={form.feature2}
        onChange={(value) => onFieldChange("feature2", value)}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <DraftInput
          label="Length"
          value={form.length}
          onChange={(value) => onFieldChange("length", value)}
        />

        <DraftInput
          label="Pit to Pit"
          value={form.pitToPit}
          onChange={(value) => onFieldChange("pitToPit", value)}
        />

        <DraftInput
          label="Waist"
          value={form.waist}
          onChange={(value) => onFieldChange("waist", value)}
        />
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={onSendPayload}
          disabled={!isReadyToSend}
          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            isReadyToSend
              ? "hover:bg-zinc-50"
              : "cursor-not-allowed border-zinc-300 bg-zinc-100 text-zinc-500"
          }`}
        >
          Send payload to Vendoo extension
        </button>

        {sendFeedback.status !== "idle" ? (
          <div
            className={`mt-2 text-xs font-medium ${
              sendFeedback.status === "sent" ? "text-green-700" : "text-red-700"
            }`}
          >
            {sendFeedback.message}
          </div>
        ) : null}
      </div>
    </section>
  );
}
