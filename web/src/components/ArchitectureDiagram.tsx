/**
 * Hand-built SVG diagram of the CloudPulse architecture.
 * Each box has a number that matches the caption cards on the Architecture page.
 * Boxes are placed at explicit coordinates; the Vercel Function is a tall box in the middle
 * because almost everything connects to it.
 */

type Group = "edge" | "compute" | "data" | "ops" | "external" | "tooling";

export const GROUPS: Record<Group, { label: string; color: string; dashed?: boolean }> = {
  edge: { label: "Edge network", color: "var(--cat-1)" },
  compute: { label: "Compute & scheduling", color: "var(--cat-2)" },
  data: { label: "Data & secrets", color: "var(--cat-3)" },
  ops: { label: "Alerts & observability", color: "var(--cat-4)" },
  external: { label: "Outside the platform", color: "var(--axis)", dashed: true },
  tooling: { label: "Build & deploy tooling", color: "var(--axis)", dashed: true },
};

interface Node {
  n: number;
  x: number;
  y: number;
  h?: number;
  title: string;
  sub: string;
  group: Group;
  lines?: string[]; // extra text inside tall boxes
}

const W = 150;
const H = 64;
const COL = [20, 225, 430, 645];

export const NODES: Node[] = [
  { n: 1, x: COL[0]!, y: 40, title: "Browser", sub: "React app", group: "external" },
  { n: 2, x: COL[1]!, y: 40, title: "Vercel CDN", sub: "static site + cache", group: "edge" },
  {
    n: 3,
    x: COL[2]!,
    y: 40,
    h: 364,
    title: "Vercel Function",
    sub: "api/index.ts",
    group: "compute",
    lines: ["routes every /api/* call", "checks admin login", "rate-limits by IP", "runs the uptime checks", "opens / closes incidents"],
  },
  { n: 4, x: COL[3]!, y: 40, title: "Upstash Redis", sub: "data + rate limits", group: "data" },
  { n: 5, x: COL[3]!, y: 140, title: "Env variables", sub: "secrets, encrypted", group: "data" },
  { n: 6, x: COL[3]!, y: 240, title: "Discord", sub: "alert webhook", group: "ops" },
  { n: 7, x: COL[3]!, y: 340, title: "Your websites", sub: "monitored URLs", group: "external" },
  { n: 8, x: COL[1]!, y: 200, title: "GitHub Actions", sub: "schedule · 5 min", group: "compute" },
  { n: 9, x: COL[1]!, y: 300, title: "Vercel Cron", sub: "daily backup run", group: "compute" },
  { n: 10, x: COL[2]!, y: 440, title: "Vercel Logs", sub: "runtime logs", group: "ops" },
  { n: 11, x: COL[0]!, y: 330, title: "GitHub CI", sub: "lint · test · build", group: "tooling" },
  { n: 12, x: COL[0]!, y: 430, title: "Git deploys", sub: "push = new version", group: "tooling" },
];

interface Edge {
  d: string;
  label: string;
  lx: number;
  ly: number;
  anchor?: "start" | "middle" | "end";
}

/** Horizontal arrow at height y from x1 to x2, labelled above the middle. */
function across(x1: number, x2: number, y: number, label: string): Edge {
  return { d: `M${x1},${y} L${x2 - 2},${y}`, label, lx: (x1 + x2) / 2, ly: y - 7 };
}

const fnLeft = COL[2]!;
const fnRight = COL[2]! + W;

const EDGES: Edge[] = [
  across(COL[0]! + W, COL[1]!, 72, "HTTPS"),
  across(COL[1]! + W, fnLeft, 72, "/api/*"),
  across(fnRight, COL[3]!, 72, "data"),
  across(fnRight, COL[3]!, 172, "secrets"),
  across(fnRight, COL[3]!, 272, "alerts"),
  across(fnRight, COL[3]!, 372, "GET"),
  across(COL[1]! + W, fnLeft, 232, "5 min"),
  across(COL[1]! + W, fnLeft, 332, "daily"),
  { d: `M${fnLeft + W / 2},404 L${fnLeft + W / 2},438`, label: "logs", lx: fnLeft + W / 2 + 7, ly: 425, anchor: "start" },
];

export function ArchitectureDiagram() {
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 815 530"
        className="min-w-[680px] w-full"
        role="img"
        aria-label="CloudPulse architecture: the browser reaches Vercel's CDN, which serves the site and forwards /api calls to one Vercel Function. The function stores data in Upstash Redis, reads secrets from environment variables, checks websites and posts alerts to Discord. GitHub Actions calls it every 5 minutes, Vercel Cron once a day."
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>

        {/* Build & deploy region */}
        <rect x={8} y={318} width={174} height={204} rx={14} fill="none" stroke="var(--axis)" strokeDasharray="5 5" />
        <text x={95} y={514} textAnchor="middle" fontSize={11} fill="var(--muted)">
          builds, tests & deploys
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
          const h = node.h ?? H;
          return (
            <g key={node.n}>
              <rect
                x={node.x}
                y={node.y}
                width={W}
                height={h}
                rx={10}
                fill="var(--surface)"
                stroke={group.dashed ? "var(--axis)" : "var(--border)"}
                strokeDasharray={group.dashed ? "4 4" : undefined}
              />
              {!group.dashed && <rect x={node.x} y={node.y + 10} width={4} height={h - 20} rx={2} fill={group.color} />}
              <text x={node.x + 14} y={node.y + 27} fontSize={13} fontWeight={600} fill="var(--ink)">
                {node.title}
              </text>
              <text x={node.x + 14} y={node.y + 46} fontSize={11} fill="var(--muted)">
                {node.sub}
              </text>
              {node.lines?.map((line, i) => (
                <text key={line} x={node.x + 14} y={node.y + 92 + i * 26} fontSize={11} fill="var(--ink-2)">
                  • {line}
                </text>
              ))}
              <circle cx={node.x + W - 14} cy={node.y + 14} r={9} fill="var(--surface-2)" />
              <text x={node.x + W - 14} y={node.y + 18} fontSize={10} fontWeight={600} textAnchor="middle" fill="var(--ink-2)">
                {node.n}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
