type EbayDescriptionCardProps = {
  description: string;
};

export function EbayDescriptionCard(props: EbayDescriptionCardProps) {
  const { description } = props;

  return (
    <div className="rounded-xl bg-zinc-100 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Generated eBay Description
      </div>
      <pre className="mt-3 whitespace-pre-wrap text-sm text-zinc-900">{description}</pre>
    </div>
  );
}
