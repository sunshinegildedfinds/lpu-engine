"use client";

import { useMemo, useState } from "react";
import { sendVendooPayloadToExtension } from "@/lib/sendVendooPayloadToExtension";
import { buildVendooExtensionPayload } from "@/lib/vendoo/extensionPayload";
import {
  buildEbayDescription,
  buildEbayTitleA,
  buildEbayTitleB,
  type EbayDraftInput,
} from "@/lib/ebay/generateDraft";
import { validateEbayDraft } from "@/lib/ebay/validateDraft";
import { selectFinalEbayTitle } from "@/lib/ebay/selectFinalTitle";

export default function Home() {
  const [form, setForm] = useState<EbayDraftInput>({
    brand: "Free People",
    itemType: "Maxi Dress",
    size: "Small",
    color: "Blue Floral",
    feature1: "Boho",
    feature2: "Puff Sleeve",
    length: '52"',
    pitToPit: '17"',
    waist: '14"',
  });

  function updateField<K extends keyof EbayDraftInput>(
    key: K,
    value: EbayDraftInput[K]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  const titleA = useMemo(() => buildEbayTitleA(form), [form]);
  const titleB = useMemo(() => buildEbayTitleB(form), [form]);
  const description = useMemo(() => buildEbayDescription(form), [form]);

  const validation = useMemo(
    () =>
      validateEbayDraft({
        titleA,
        titleB,
        description,
      }),
    [titleA, titleB, description]
  );

  const finalTitleSelection = useMemo(
    () =>
      selectFinalEbayTitle({
        titleA,
        titleB,
        draftInput: form,
      }),
    [titleA, titleB, form]
  );

  const payloadMap = useMemo(
    () =>
      buildVendooExtensionPayload({
        title: finalTitleSelection.selectedTitle,
        titleA,
        titleB,
        description,
      }),
    [finalTitleSelection.selectedTitle, titleA, titleB, description]
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8">
      <main className="w-full max-w-6xl rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">
          LPU Engine Payload Sender
        </h1>

        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Enter item facts. The app generates eBay Title A, Title B, and
          Description, validates them, selects the stronger final title, then
          sends the payload to the private Vendoo extension.
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <section className="grid gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-800">
                Brand
              </label>
              <input
                type="text"
                value={form.brand}
                onChange={(e) => updateField("brand", e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-800">
                Item Type
              </label>
              <input
                type="text"
                value={form.itemType}
                onChange={(e) => updateField("itemType", e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-800">
                Size
              </label>
              <input
                type="text"
                value={form.size}
                onChange={(e) => updateField("size", e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-800">
                Color
              </label>
              <input
                type="text"
                value={form.color}
                onChange={(e) => updateField("color", e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-800">
                Feature 1
              </label>
              <input
                type="text"
                value={form.feature1}
                onChange={(e) => updateField("feature1", e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-800">
                Feature 2
              </label>
              <input
                type="text"
                value={form.feature2}
                onChange={(e) => updateField("feature2", e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-800">
                  Length
                </label>
                <input
                  type="text"
                  value={form.length}
                  onChange={(e) => updateField("length", e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-800">
                  Pit to Pit
                </label>
                <input
                  type="text"
                  value={form.pitToPit}
                  onChange={(e) => updateField("pitToPit", e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-800">
                  Waist
                </label>
                <input
                  type="text"
                  value={form.waist}
                  onChange={(e) => updateField("waist", e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => sendVendooPayloadToExtension(payloadMap)}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-zinc-50"
              >
                Send payload to Vendoo extension
              </button>
            </div>
          </section>

          <section className="grid gap-4">
            <div className="rounded-xl bg-zinc-100 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Generated eBay Title A
              </div>
              <div className="mt-3 text-sm text-zinc-900">{titleA}</div>
              <div className="mt-2 text-xs text-zinc-500">
                Character count: {titleA.length}
              </div>
            </div>

            <div className="rounded-xl bg-zinc-100 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Generated eBay Title B
              </div>
              <div className="mt-3 text-sm text-zinc-900">{titleB}</div>
              <div className="mt-2 text-xs text-zinc-500">
                Character count: {titleB.length}
              </div>
            </div>

            <div className="rounded-xl bg-zinc-100 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Selected Final eBay Title
                </div>
                <div className="text-xs font-semibold text-zinc-700">
                  Using Title {finalTitleSelection.selectedSource}
                </div>
              </div>

              <div className="mt-3 text-sm text-zinc-900">
                {finalTitleSelection.selectedTitle}
              </div>

              <div className="mt-3 grid gap-2 text-xs text-zinc-600">
                <div>
                  <span className="font-medium text-zinc-800">Title A score:</span>{" "}
                  {finalTitleSelection.titleA.score}
                </div>
                <div>
                  <span className="font-medium text-zinc-800">Title B score:</span>{" "}
                  {finalTitleSelection.titleB.score}
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-zinc-100 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Generated eBay Description
              </div>
              <pre className="mt-3 whitespace-pre-wrap text-sm text-zinc-900">
                {description}
              </pre>
            </div>

            <div className="rounded-xl bg-zinc-100 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  eBay Validation
                </div>
                <div
                  className={`text-xs font-semibold ${
                    validation.isValid ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {validation.passed}/{validation.total} passed
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                {validation.checks.map((check) => (
                  <div
                    key={check.label}
                    className="rounded-lg border bg-white px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-zinc-900">{check.label}</span>
                      <span
                        className={`font-medium ${
                          check.pass ? "text-green-700" : "text-red-700"
                        }`}
                      >
                        {check.pass ? "PASS" : "FAIL"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {check.details}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-zinc-100 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Payload preview
              </div>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-zinc-800">
                {JSON.stringify(payloadMap, null, 2)}
              </pre>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}