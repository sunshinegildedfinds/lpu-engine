import type { FinalTitleSelection } from "@/lib/ebay/selectFinalTitle";

type EbayFinalTitleCardProps = {
  finalTitleSelection: FinalTitleSelection;
};

export function EbayFinalTitleCard(props: EbayFinalTitleCardProps) {
  const { finalTitleSelection } = props;

  return (
    <div className="rounded-xl bg-zinc-100 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Selected Final eBay Title
        </div>
        <div className="text-xs font-semibold text-zinc-700">
          Using Title {finalTitleSelection.selectedSource}
        </div>
      </div>

      <div className="mt-3 text-sm text-zinc-900">{finalTitleSelection.selectedTitle}</div>

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
  );
}
