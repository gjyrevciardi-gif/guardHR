import type { SVGProps } from "react";

type ShellMarkProps = SVGProps<SVGSVGElement> & {
  animated?: boolean;
};

const HEX_RADIUS = 15.5;

// Honeycomb rows, top to bottom. Rows alternate between "offset" and "aligned"
// centres so the plates interlock instead of stacking into columns.
const rows: { y: number; plates: { x: number; fill: string }[] }[] = [
  {
    y: 76,
    plates: [
      { x: 69.8, fill: "#6e9c63" },
      { x: 96.6, fill: "#7fb16c" },
      { x: 123.4, fill: "#6e9c63" },
      { x: 150.2, fill: "#5f8f58" },
    ],
  },
  {
    y: 99,
    plates: [
      { x: 56.4, fill: "#7fb16c" },
      { x: 83.2, fill: "#8cba7a" },
      { x: 110, fill: "#9dc88d" },
      { x: 136.8, fill: "#8cba7a" },
      { x: 163.6, fill: "#6e9c63" },
    ],
  },
  {
    y: 122,
    plates: [
      { x: 69.8, fill: "#8cba7a" },
      { x: 96.6, fill: "#b6d9a6" },
      { x: 123.4, fill: "#c8e5b8" },
      { x: 150.2, fill: "#9dc88d" },
    ],
  },
  {
    y: 145,
    plates: [
      { x: 83.2, fill: "#b6d9a6" },
      { x: 110, fill: "#c8e5b8" },
      { x: 136.8, fill: "#8cba7a" },
    ],
  },
  {
    y: 168,
    plates: [
      { x: 96.6, fill: "#9dc88d" },
      { x: 123.4, fill: "#8cba7a" },
    ],
  },
];

function hexPoints(cx: number, cy: number, r: number) {
  const w = r * 0.866;
  return [
    `${cx},${cy - r}`,
    `${cx + w},${cy - r / 2}`,
    `${cx + w},${cy + r / 2}`,
    `${cx},${cy + r}`,
    `${cx - w},${cy + r / 2}`,
    `${cx - w},${cy - r / 2}`,
  ].join(" ");
}

export function ShellMark({ animated = false, className = "", ...props }: ShellMarkProps) {
  return (
    <svg
      viewBox="0 0 220 220"
      fill="none"
      aria-hidden="true"
      className={`${animated ? "shell-swim" : ""} ${className}`}
      {...props}
    >
      {/* head */}
      <ellipse cx="110" cy="34" rx="28" ry="21" fill="#9dc88d" />
      <circle cx="100" cy="28" r="4.2" fill="#143a31" />
      <circle cx="120" cy="28" r="4.2" fill="#143a31" />

      {/* flippers, behind the carapace */}
      <g className={animated ? "shell-paddle" : ""}>
        <ellipse cx="30" cy="82" rx="30" ry="11" fill="#8cba7a" transform="rotate(-18 30 82)" />
        <ellipse cx="46" cy="176" rx="26" ry="10" fill="#7fb16c" transform="rotate(30 46 176)" />
      </g>
      <g className={animated ? "shell-paddle-back" : ""}>
        <ellipse cx="190" cy="82" rx="30" ry="11" fill="#8cba7a" transform="rotate(18 190 82)" />
        <ellipse cx="174" cy="176" rx="26" ry="10" fill="#7fb16c" transform="rotate(-30 174 176)" />
      </g>

      {/* carapace */}
      <path
        d="M54 52H166C173 52 178 57 178 64V140C178 170 110 206 110 206C110 206 42 170 42 140V64C42 57 47 52 54 52Z"
        fill="#e7f1e0"
        stroke="#c8e5b8"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {rows.map((row) =>
        row.plates.map((plate) => (
          <polygon
            key={`${row.y}-${plate.x}`}
            points={hexPoints(plate.x, row.y, HEX_RADIUS)}
            fill={plate.fill}
          />
        )),
      )}
    </svg>
  );
}
