"use client";

import type { OptionalPriceInput, ResearchRecord } from "@/lib/research/types";

type ResearchPanelProps = {
  researchRecord: ResearchRecord;
  priceDecision: OptionalPriceInput;
  onPriceDecisionChange: (next: OptionalPriceInput) => void;
};

export function ResearchPanel(props: ResearchPanelProps) {
  const { researchRecord, priceDecision, onPriceDecisionChange } = props;

  return (
    <section className="mt-8 rounded-2xl border p-6">
      <h2 className="text-2xl font-semibold">Research Record (Preview)</h2>
      <p className="mt-2 text-sm text-gray-600">
        Built from validated payload. This panel is additive-only and does not
        alter current send behavior.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Search Seed
          </div>
          <div className="mt-2 text-sm">{researchRecord.searchSeed.join(" • ") || "—"}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Primary Query
          </div>
          <div className="mt-2 text-sm">{researchRecord.primaryQuery || "—"}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border p-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">
          Alternate Queries
        </div>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {researchRecord.alternateQueries.length ? (
            researchRecord.alternateQueries.map((query) => <li key={query}>{query}</li>)
          ) : (
            <li>—</li>
          )}
        </ul>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <a
          href={researchRecord.soldCompLink}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border p-4 text-sm underline"
        >
          Sold comps
        </a>
        <a
          href={researchRecord.completedCompLink}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border p-4 text-sm underline"
        >
          Completed comps
        </a>
        <a
          href={researchRecord.activeCompLink || "#"}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border p-4 text-sm underline"
        >
          Active comps (placeholder)
        </a>
      </div>

      <div className="mt-6 rounded-xl border p-4">
        <h3 className="text-lg font-semibold">Optional Price Input</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Selected Price</span>
            <input
              value={priceDecision.selectedPrice}
              onChange={(event) =>
                onPriceDecisionChange({
                  ...priceDecision,
                  selectedPrice: event.target.value,
                })
              }
              className="rounded-lg border p-2"
              placeholder="e.g. 129.00"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium">Floor Price</span>
            <input
              value={priceDecision.floorPrice}
              onChange={(event) =>
                onPriceDecisionChange({
                  ...priceDecision,
                  floorPrice: event.target.value,
                })
              }
              className="rounded-lg border p-2"
              placeholder="e.g. 95.00"
            />
          </label>
        </div>

        <label className="mt-3 grid gap-1 text-sm">
          <span className="font-medium">Pricing Note</span>
          <textarea
            value={priceDecision.pricingNote}
            onChange={(event) =>
              onPriceDecisionChange({
                ...priceDecision,
                pricingNote: event.target.value,
              })
            }
            className="rounded-lg border p-2"
            rows={3}
            placeholder="Optional rationale"
          />
        </label>
      </div>
    </section>
  );
}

