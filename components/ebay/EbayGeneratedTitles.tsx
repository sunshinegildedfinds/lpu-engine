type EbayGeneratedTitlesProps = {
  titleA: string;
  titleB: string;
};

function TitleCard(props: {
  heading: string;
  title: string;
}) {
  const { heading, title } = props;

  return (
    <div className="rounded-xl bg-zinc-100 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {heading}
      </div>
      <div className="mt-3 text-sm text-zinc-900">{title}</div>
      <div className="mt-2 text-xs text-zinc-500">Character count: {title.length}</div>
    </div>
  );
}

export function EbayGeneratedTitles(props: EbayGeneratedTitlesProps) {
  const { titleA, titleB } = props;

  return (
    <>
      <TitleCard heading="Generated eBay Title A" title={titleA} />
      <TitleCard heading="Generated eBay Title B" title={titleB} />
    </>
  );
}
