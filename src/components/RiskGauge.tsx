type Props = {
  /** Estimated % chance of significant wildfire activity within ~10 days (heuristic). */
  probabilityPct: number;
  cls: string;
  /** Model not calibrated for this location — show OUT OF RANGE instead of score */
  outOfRange?: boolean;
};

export function RiskGauge({ probabilityPct, cls, outOfRange }: Props) {
  if (outOfRange) {
    return (
      <div className="gauge-wrap gauge-wrap--oor">
        <svg className="gauge-svg gauge-svg--oor" viewBox="0 0 200 200" aria-hidden>
          <circle
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="14"
          />
          <text
            x="100"
            y="95"
            textAnchor="middle"
            fill="currentColor"
            fontSize="15"
            fontWeight="700"
            opacity="0.85"
          >
            OUT OF
          </text>
          <text
            x="100"
            y="118"
            textAnchor="middle"
            fill="currentColor"
            fontSize="15"
            fontWeight="700"
            opacity="0.85"
          >
            RANGE
          </text>
        </svg>
        <p className="gauge-sub gauge-sub--oor">
          Model trained for Western US — weather below still applies; score not valid here.
        </p>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, probabilityPct));
  const rot = (pct / 100) * 270 - 135;
  let stroke = "#22c55e";
  if (pct >= 80) stroke = "#a855f7";
  else if (pct >= 60) stroke = "#ef4444";
  else if (pct >= 30) stroke = "#f59e0b";

  return (
    <div className="gauge-wrap">
      <svg className="gauge-svg" viewBox="0 0 200 200" aria-hidden>
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="14"
        />
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke={stroke}
          strokeWidth="14"
          strokeDasharray={`${(pct / 100) * 502.4} 502.4`}
          strokeLinecap="round"
          transform="rotate(-135 100 100)"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <line
          x1="100"
          y1="100"
          x2="100"
          y2="40"
          stroke={stroke}
          strokeWidth="4"
          strokeLinecap="round"
          transform={`rotate(${rot} 100 100)`}
          style={{ transition: "transform 0.6s ease" }}
        />
        <text
          x="100"
          y="102"
          textAnchor="middle"
          fill="currentColor"
          fontSize="32"
          fontWeight="700"
        >
          {Math.round(pct)}
        </text>
        <text
          x="100"
          y="128"
          textAnchor="middle"
          fill="currentColor"
          fontSize="14"
          fontWeight="600"
          opacity="0.9"
        >
          %
        </text>
      </svg>
      <p className="gauge-sub">
        {cls} · estimated chance of wildfire in the <strong>next ~10 days</strong> (model blend — not a guarantee)
      </p>
    </div>
  );
}
