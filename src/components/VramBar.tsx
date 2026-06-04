interface Props {
  percent: number;
  className?: string;
}

export function VramBar({ percent, className }: Props) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div className={className ?? "bar-track"}>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
