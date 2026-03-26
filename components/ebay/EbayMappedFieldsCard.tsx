import type { EbayMappedFillFields } from "@/lib/ebay/buildEbayFillFields";

type EbayMappedFieldsCardProps = {
  mappedFields: EbayMappedFillFields;
};

export function EbayMappedFieldsCard(props: EbayMappedFieldsCardProps) {
  const { mappedFields } = props;

  return (
    <div className="rounded-xl bg-zinc-100 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Mapped eBay fill fields
      </div>

      <div className="mt-3 grid gap-2 text-sm text-zinc-900">
        <div>
          <span className="font-medium text-zinc-700">Category:</span> {mappedFields.category || "-"}
        </div>
        <div>
          <span className="font-medium text-zinc-700">Brand:</span>{" "}
          {mappedFields.itemSpecifics.brand || "-"}
        </div>
        <div>
          <span className="font-medium text-zinc-700">Size:</span> {mappedFields.itemSpecifics.size || "-"}
        </div>
        <div>
          <span className="font-medium text-zinc-700">Color:</span> {mappedFields.itemSpecifics.color || "-"}
        </div>
      </div>
    </div>
  );
}
