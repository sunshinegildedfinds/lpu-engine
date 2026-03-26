import type { ReadyToSendState } from "@/lib/vendoo/getReadyToSendState";

type ReadyToSendCardProps = {
  state: ReadyToSendState;
};

export function ReadyToSendCard(props: ReadyToSendCardProps) {
  const { state } = props;

  return (
    <div className="rounded-xl border bg-zinc-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Vendoo send gate
        </div>
        <div
          className={`text-xs font-semibold ${
            state.isReadyToSend ? "text-green-700" : "text-red-700"
          }`}
        >
          {state.summaryLabel}
        </div>
      </div>

      {state.isReadyToSend ? (
        <div className="mt-2 text-sm text-green-800">All core checks are passing.</div>
      ) : (
        <div className="mt-3">
          <div className="text-xs font-medium text-zinc-700">Blocking issues:</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800">
            {state.blockingIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
