"use client";

import { useMemo, useState } from "react";
import { EbayDescriptionCard } from "@/components/ebay/EbayDescriptionCard";
import { EbayDraftForm } from "@/components/ebay/EbayDraftForm";
import { EbayFinalTitleCard } from "@/components/ebay/EbayFinalTitleCard";
import { EbayGeneratedTitles } from "@/components/ebay/EbayGeneratedTitles";
import { EbayMappedFieldsCard } from "@/components/ebay/EbayMappedFieldsCard";
import { EbayValidationCard } from "@/components/ebay/EbayValidationCard";
import { PayloadPreviewCard } from "@/components/vendoo/PayloadPreviewCard";
import { ReadyToSendCard } from "@/components/vendoo/ReadyToSendCard";
import { buildEbayFillFields } from "@/lib/ebay/buildEbayFillFields";
import {
  buildEbayDescription,
  buildEbayTitleA,
  buildEbayTitleB,
  type EbayDraftInput,
} from "@/lib/ebay/generateDraft";
import { selectFinalEbayTitle } from "@/lib/ebay/selectFinalTitle";
import { validateEbayDraft } from "@/lib/ebay/validateDraft";
import { sendVendooPayloadToExtension } from "@/lib/sendVendooPayloadToExtension";
import { buildVendooCategoryPath } from "@/lib/vendoo/buildVendooCategoryPath";
import { getReadyToSendState } from "@/lib/vendoo/getReadyToSendState";
import { buildVendooExtensionPayload } from "@/lib/vendoo/extensionPayload";

const INITIAL_FORM: EbayDraftInput = {
  brand: "Free People",
  itemType: "Maxi Dress",
  size: "Small",
  color: "Blue Floral",
  feature1: "Boho",
  feature2: "Puff Sleeve",
  length: '52"',
  pitToPit: '17"',
  waist: '14"',
};

type SendFeedbackState = {
  status: "idle" | "sent" | "failed";
  message: string;
};

const INITIAL_SEND_FEEDBACK: SendFeedbackState = {
  status: "idle",
  message: "",
};

export default function Home() {
  const [form, setForm] = useState<EbayDraftInput>(INITIAL_FORM);
  const [sendFeedback, setSendFeedback] =
    useState<SendFeedbackState>(INITIAL_SEND_FEEDBACK);

  function updateField(key: keyof EbayDraftInput, value: string) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));

    setSendFeedback(INITIAL_SEND_FEEDBACK);
  }

  const titleA = useMemo(() => buildEbayTitleA(form), [form]);
  const titleB = useMemo(() => buildEbayTitleB(form), [form]);
  const description = useMemo(() => buildEbayDescription(form), [form]);
  const mappedFields = useMemo(() => buildEbayFillFields(form), [form]);

  const canonicalVendooCategoryPath = useMemo(
    () =>
      buildVendooCategoryPath({
        simpleCategory: mappedFields.category,
      }),
    [mappedFields.category]
  );

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

  const readyToSend = useMemo(
    () =>
      getReadyToSendState({
        finalTitleSelection,
        validation,
      }),
    [finalTitleSelection, validation]
  );

  const payloadMap = useMemo(
    () =>
      buildVendooExtensionPayload({
        title: finalTitleSelection.selectedTitle,
        titleA,
        titleB,
        description,
        category: mappedFields.category,
        canonicalVendooCategoryPath,
        itemSpecifics: mappedFields.itemSpecifics,
      }),
    [
      canonicalVendooCategoryPath,
      description,
      finalTitleSelection.selectedTitle,
      mappedFields.category,
      mappedFields.itemSpecifics,
      titleA,
      titleB,
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

    const sent = sendVendooPayloadToExtension(payloadMap);
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
            <ReadyToSendCard state={readyToSend} />
            <EbayDraftForm
              form={form}
              onFieldChange={updateField}
              onSendPayload={handleSendPayload}
              isReadyToSend={readyToSend.isReadyToSend}
              sendFeedback={sendFeedback}
            />
          </section>

          <section className="grid gap-4">
            <EbayGeneratedTitles titleA={titleA} titleB={titleB} />
            <EbayFinalTitleCard finalTitleSelection={finalTitleSelection} />
            <EbayDescriptionCard description={description} />
            <EbayValidationCard validation={validation} />
            <EbayMappedFieldsCard mappedFields={mappedFields} />
            <PayloadPreviewCard payload={payloadMap} />
          </section>
        </div>
      </main>
    </div>
  );
}
