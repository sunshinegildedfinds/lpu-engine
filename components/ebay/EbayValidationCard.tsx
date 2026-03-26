import type { EbayValidationResult } from "@/lib/ebay/validateDraft";

type EbayValidationCardProps = {
  validation: EbayValidationResult;
};

export function EbayValidationCard(props: EbayValidationCardProps) {
  const { validation } = props;

  return (
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
          <div key={check.label} className="rounded-lg border bg-white px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-zinc-900">{check.label}</span>
              <span className={`font-medium ${check.pass ? "text-green-700" : "text-red-700"}`}>
                {check.pass ? "PASS" : "FAIL"}
              </span>
            </div>
            <div className="mt-1 text-xs text-zinc-500">{check.details}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
