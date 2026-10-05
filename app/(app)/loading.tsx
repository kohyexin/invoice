export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true">
      <div className="mb-2 h-7 w-56 rounded-control bg-overlay/[0.08]" />
      <div className="mb-8 h-4 w-96 max-w-full rounded-control bg-overlay/[0.06]" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-card border border-line bg-overlay/[0.04]" />
        ))}
      </div>
      <div className="h-96 rounded-card border border-line bg-overlay/[0.04]" />
    </div>
  );
}
