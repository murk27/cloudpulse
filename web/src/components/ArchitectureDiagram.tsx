/**
 * Hand-built SVG diagram of the CloudPulse architecture.
 * Each box has a number that matches the caption cards on the Architecture page.
 * Layout: a 5-column x 4-row grid; arrows are straight lines between box edges.
 */

type Group = "edge" | "compute" | "data" | "ops" | "external" | "tooling";

export const GROUPS: Record<Group, { label: string; color: string; dashed?: boolean }> = {
  edge: { label: "Edge & API", color: "var(--cat-1)" },
  compute: { label: "Compute & events", color: "var(--cat-2)" },
  data: { label: "Storage & secrets", color: "var(--cat-3)" },
  ops: { label: "Alerts & observability", color: "var(--cat-4)" },
  external: { label: "Outside AWS", color: "var(--axis)", dashed: true },
  tooling: { label: "Build & deploy tooling", color: "var(--axis)", dashed: true },
};

interface Node {
  n: number;
  col: number;
  row: number;
  title: string;
  sub: string;
  group: Group;
}

export const NODES: Node[] = [
  { n: 1, col: 0, row: 0, title: "Browser", sub: "React app", group: "external" },
  { n: 2, col: 1, row: 0, title: "CloudFront", sub: "CDN · HTTPS", group: "edge" },
  { n: 3, col: 2, row: 0, title: "API Gateway", sub: "HTTP API · throttling", group: "edge" },
  { n: 4, col: 3, row: 0, title: "Lambda: api", sub: "routes + login", group: "compute" },
  { n: 5, col: 4, row: 0, title: "Parameter Store", sub: "encrypted password", group: "data" },
  { n: 6, col: 1, row: 1, title: "S3 bucket", sub: "website (private)", group: "data" },
  { n: 7, col: 3, row: 1, title: "DynamoDB", sub: "single table + TTL", group: "data" },
  { n: 8, col: 2, row: 2, title: "EventBridge", sub: "Scheduler · 5 min", group: "compute" },
  { n: 9, col: 3, row: 2, title: "Lambda: checker", sub: "parallel HTTP checks", group: "compute" },
  { n: 10, col: 4, row: 2, title: "Your websites", sub: "monitored URLs", group: "external" },
  { n: 11, col: 2, row: 3, title: "CloudWatch", sub: "logs · metrics · alarm", group: "ops" },
  { n: 12, col: 3, row: 3, title: "SNS topic", sub: "alert fan-out", group: "ops" },
  { n: 13, col: 4, row: 3, title: "Email inbox", sub: "DOWN / RECOVERED", group: "external" },
  { n: 14, col: 0, row: 2, title: "AWS SAM", sub: "CloudFormation IaC", group: "tooling" },
  { n: 15, col: 0, row: 3, title: "GitHub Actions", sub: "CI: lint · test · build", group: "tooling" },
];

// Grid geometry (SVG user units).
const W = 150;
const H = 64;
const COL_X = [20, 215, 410, 605, 800];
const ROW_Y = [40, 160, 290, 420];

const x = (col: number) => COL_X[col] ?? 0;
const y = (row: number) => ROW_Y[row] ?? 0;

interface Edge {
  d: string; // SVG path
  label: string;
  lx: number;
  ly: number;
  anchor?: "start" | "middle" | "end";
}

/** Horizontal arrow from the right edge of (col,row) to the left edge of (col+1,row). */
function right(col: number, row: number, label: string): Edge {
  const x1 = x(col) + W;
  const x2 = x(col + 1);
  const yy = y(row) + H / 2;
  return { d: `M${x1},${yy} L${x2 - 2},${yy}`, label, lx: (x1 + x2) / 2, ly: yy - 7 };
}

/** Vertical arrow in a column between two rows (down if toRow > fromRow, else up). */
function vertical(col: number, fromRow: number, toRow: number, label: string): Edge {
  const xx = x(col) + W / 2;
  const down = toRow > fromRow;
  const y1 = down ? y(fromRow) + H : y(fromRow);
  const y2 = down ? y(toRow) - 2 : y(toRow) + H + 2;
  return { d: `M${xx},${y1} L${xx},${y2}`, label, lx: xx + 7, ly: (y1 + y2) / 2 + 4, anchor: "start" };
}

const EDGES: Edge[] = [
  right(0, 0, "HTTPS"),
  right(1, 0, "/api/*"),
  right(2, 0, "invoke"),
  right(3, 0, "read"),
  vertical(1, 0, 1, "files (OAC)"),
  vertical(3, 0, 1, "read / write"),
  right(2, 2, "invoke"),
  vertical(3, 2, 1, "save checks"),
  right(3, 2, "GET"),
  vertical(3, 2, 3, "publish"),
  right(3, 3, "email"),
  right(2, 3, "alarm"),
  // Checker -> CloudWatch: a short diagonal down-left.
  {
    d: `M${x(3) + 12},${y(2) + H} L${x(2) + W - 6},${y(3) - 4}`,
    label: "logs + metrics",
    lx: x(3) - 40,
    ly: y(3) - 30,
    anchor: "end",
  },
];

export function ArchitectureDiagram() {
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 970 540"
        className="min-w-[760px] w-full"
        role="img"
        aria-label="CloudPulse architecture: browser to CloudFront, API Gateway and Lambda; EventBridge Scheduler runs the checker Lambda, which writes to DynamoDB and alerts through SNS."
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>

        {/* Build & deploy region */}
        <rect x={8} y={272} width={174} height={260} rx={14} fill="none" stroke="var(--axis)" strokeDasharray="5 5" />
        <text x={95} y={520} textAnchor="middle" fontSize={11} fill="var(--muted)">
          deploys & tests everything
        </text>

        {EDGES.map((edge, i) => (
          <g key={i}>
            <path d={edge.d} stroke="var(--muted)" strokeWidth={1.5} fill="none" markerEnd="url(#arrow)" />
            <text x={edge.lx} y={edge.ly} textAnchor={edge.anchor ?? "middle"} fontSize={11} fill="var(--ink-2)">
              {edge.label}
            </text>
          </g>
        ))}

        {NODES.map((node) => {
          const group = GROUPS[node.group];
          const nx = x(node.col);
          const ny = y(node.row);
          return (
            <g key={node.n}>
              <rect
                x={nx}
                y={ny}
                width={W}
                height={H}
                rx={10}
                fill="var(--surface)"
                stroke={group.dashed ? "var(--axis)" : "var(--border)"}
                strokeDasharray={group.dashed ? "4 4" : undefined}
              />
              {!group.dashed && <rect x={nx} y={ny + 10} width={4} height={H - 20} rx={2} fill={group.color} />}
              <text x={nx + 14} y={ny + 27} fontSize={13} fontWeight={600} fill="var(--ink)">
                {node.title}
              </text>
              <text x={nx + 14} y={ny + 46} fontSize={11} fill="var(--muted)">
                {node.sub}
              </text>
              <circle cx={nx + W - 14} cy={ny + 14} r={9} fill="var(--surface-2)" />
              <text x={nx + W - 14} y={ny + 18} fontSize={10} fontWeight={600} textAnchor="middle" fill="var(--ink-2)">
                {node.n}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
