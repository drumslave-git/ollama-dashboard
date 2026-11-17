interface Props {
  percent: number;
  blocks?: number;
}

/** Progress drawn as memory blocks filling left to right. */
export function BlockBar({ percent, blocks = 50 }: Props) {
  const pct = Math.min(100, Math.max(0, percent));
  const filled = Math.round((pct / 100) * blocks);
  return (
    <div
      className="block-bar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: blocks }, (_, i) => (
        <span key={i} className={i < filled ? "block filled" : "block"} />
      ))}
    </div>
  );
}
