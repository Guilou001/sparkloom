export function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold" style={{ color: "var(--color-primary)" }}>
        404
      </h1>
      <p style={{ color: "var(--color-text-secondary)" }}>
        This video doesn't exist or has been removed.
      </p>
    </div>
  );
}
