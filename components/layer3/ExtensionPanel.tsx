"use client";

import { useMemo, useState } from "react";
import { PayloadPreviewCard } from "@/components/vendoo/PayloadPreviewCard";
import { ReadyToSendCard } from "@/components/vendoo/ReadyToSendCard";
import type { FinalTitleSelection } from "@/lib/ebay/selectFinalTitle";
import { validateEbayDraft } from "@/lib/ebay/validateDraft";
import { sendVendooPayloadToExtension } from "@/lib/sendVendooPayloadToExtension";
import { buildVendooCategoryPath } from "@/lib/vendoo/buildVendooCategoryPath";
import { getReadyToSendState } from "@/lib/vendoo/getReadyToSendState";
import { buildVendooExtensionPayload } from "@/lib/vendoo/extensionPayload";

type Layer3Seed = {
  titleA: string;
  titleB: string;
  description: string;
};

type SendFeedbackState = {
  status: "idle" | "sent" | "failed";
  message: string;
};

const INITIAL_SEND_FEEDBACK: SendFeedbackState = {
  status: "idle",
  message: "",
};

export function ExtensionPanel({ seed }: { seed: Layer3Seed }) {
  const [selectedSource, setSelectedSource] = useState<"A" | "B">(
    seed.titleA.trim() ? "A" : "B"
  );
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [sendFeedback, setSendFeedback] = useState<SendFeedbackState>(
    INITIAL_SEND_FEEDBACK
  );

  const selectedTitle = useMemo(
    () => (selectedSource === "A" ? seed.titleA : seed.titleB).trim(),
    [seed.titleA, seed.titleB, selectedSource]
  );

  const finalTitleSelection: FinalTitleSelection = useMemo(
    () => ({
      selectedTitle,
      selectedSource,
      titleA: {
        title: seed.titleA,
        score: 0,
        length: seed.titleA.trim().length,
        reasons: [],
      },
      titleB: {
        title: seed.titleB,
        score: 0,
        length: seed.titleB.trim().length,
        reasons: [],
      },
    }),
    [seed.titleA, seed.titleB, selectedSource, selectedTitle]
  );

  const validation = useMemo(
    () =>
      validateEbayDraft({
        titleA: seed.titleA,
        titleB: seed.titleB,
        description: seed.description,
      }),
    [seed.description, seed.titleA, seed.titleB]
  );

  const readyToSend = useMemo(
    () =>
      getReadyToSendState({
        finalTitleSelection,
        validation,
      }),
    [finalTitleSelection, validation]
  );

  const canonicalVendooCategoryPath = useMemo(
    () => buildVendooCategoryPath({ simpleCategory: category }) ?? undefined,
    [category]
  );

  const payload = useMemo(
    () =>
      buildVendooExtensionPayload({
        title: selectedTitle,
        titleA: seed.titleA,
        titleB: seed.titleB,
        description: seed.description,
        category,
        canonicalVendooCategoryPath,
        itemSpecifics: {
          brand,
          size,
          color,
        },
      }),
    [
      brand,
      canonicalVendooCategoryPath,
      category,
      color,
      seed.description,
      seed.titleA,
      seed.titleB,
      selectedTitle,
      size,
    ]
  );

  function handleSendPayload() {
    if (!readyToSend.isReadyToSend) {
      setSendFeedback({
        status: "failed",
        message: "Draft is not ready to send. Resolve blocking issues first.",
      });
      return;
    }

    const sent = sendVendooPayloadToExtension(payload);
    if (sent) {
      setSendFeedback({
        status: "sent",
        message: "Payload sent to Vendoo extension.",
      });
      return;
    }

    setSendFeedback({
      status: "failed",
      message: "Payload could not be sent from this page.",
    });
  }

  return (
    <section className="mt-8 rounded-2xl border p-6">
      <h2 className="text-2xl font-semibold">Layer 3 Extension Flow</h2>
      <p className="mt-2 text-sm text-gray-600">
        Uses the current Layer 1 / Layer 2 eBay output, previews the Vendoo
        extension payload, then sends it to the private extension.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <ReadyToSendCard state={readyToSend} />

          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Final eBay Title Source
            </h3>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedSource("A");
                  setSendFeedback(INITIAL_SEND_FEEDBACK);
                }}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  selectedSource === "A"
                    ? "border-black bg-black text-white"
                    : "border-gray-300 bg-white text-gray-800"
                }`}
              >
                Use Title A
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedSource("B");
                  setSendFeedback(INITIAL_SEND_FEEDBACK);
                }}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  selectedSource === "B"
                    ? "border-black bg-black text-white"
                    : "border-gray-300 bg-white text-gray-800"
                }`}
              >
                Use Title B
              </button>
            </div>

            <div className="mt-4 text-sm text-gray-700">
              <div>
                <span className="font-medium">Selected title:</span>{" "}
                {selectedTitle || "—"}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Length: {selectedTitle.length}
              </div>
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Vendoo Mapped Fields
            </h3>

            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Category</span>
                <input
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setSendFeedback(INITIAL_SEND_FEEDBACK);
                  }}
                  placeholder="Women > Dresses"
                  className="rounded-lg border p-2"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium">Brand</span>
                <input
                  value={brand}
                  onChange={(event) => {
                    setBrand(event.target.value);
                    setSendFeedback(INITIAL_SEND_FEEDBACK);
                  }}
                  placeholder="Brand"
                  className="rounded-lg border p-2"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium">Size</span>
                <input
                  value={size}
                  onChange={(event) => {
                    setSize(event.target.value);
                    setSendFeedback(INITIAL_SEND_FEEDBACK);
                  }}
                  placeholder="Size"
                  className="rounded-lg border p-2"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium">Color</span>
                <input
                  value={color}
                  onChange={(event) => {
                    setColor(event.target.value);
                    setSendFeedback(INITIAL_SEND_FEEDBACK);
                  }}
                  placeholder="Color"
                  className="rounded-lg border p-2"
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <button
              type="button"
              onClick={handleSendPayload}
              disabled={!readyToSend.isReadyToSend}
              className="w-full rounded-xl bg-black px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send payload to Vendoo extension
            </button>

            {sendFeedback.status !== "idle" ? (
              <p
                className={`mt-3 text-sm ${
                  sendFeedback.status === "sent"
                    ? "text-green-700"
                    : "text-red-700"
                }`}
              >
                {sendFeedback.message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Layer 1 / Layer 2 eBay Source
            </h3>
            <div className="mt-3 space-y-3 text-sm text-gray-700">
              <div>
                <div className="font-medium">Title A</div>
                <div className="mt-1 rounded-lg bg-gray-50 p-2 text-xs">
                  {seed.titleA || "—"}
                </div>
              </div>
              <div>
                <div className="font-medium">Title B</div>
                <div className="mt-1 rounded-lg bg-gray-50 p-2 text-xs">
                  {seed.titleB || "—"}
                </div>
              </div>
              <div>
                <div className="font-medium">Description</div>
                <div className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-xs">
                  {seed.description || "—"}
                </div>
              </div>
            </div>
          </div>

          <PayloadPreviewCard payload={payload} />
        </div>
      </div>
    </section>
  );
}
