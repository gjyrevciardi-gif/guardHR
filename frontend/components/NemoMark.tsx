import type { SVGProps } from "react";

type NemoMarkProps = SVGProps<SVGSVGElement> & {
  animated?: boolean;
};

export function NemoMark({ animated = false, className = "", ...props }: NemoMarkProps) {
  return (
    <svg
      viewBox="0 0 220 140"
      fill="none"
      aria-hidden="true"
      className={`${animated ? "nemo-swimmer" : ""} ${className}`}
      {...props}
    >
      <path
        d="M34 82C54 48 91 35 127 44C157 51 180 70 204 95C171 107 141 104 116 91C92 78 72 67 34 82Z"
        fill="#0D7BD7"
      />
      <path
        d="M53 52C83 18 124 18 146 44C118 55 96 70 79 96C65 85 54 69 53 52Z"
        fill="#7DDCFF"
        opacity="0.92"
      />
      <path
        d="M95 99C118 112 151 112 185 98C157 126 111 130 83 107C87 104 91 101 95 99Z"
        fill="#045DAD"
        opacity="0.72"
      />
      <g className={animated ? "nemo-tail" : ""}>
        <path
          d="M34 82C20 89 12 102 11 119C28 114 42 104 51 91C45 88 39 85 34 82Z"
          fill="#0D7BD7"
          opacity="0.76"
        />
        <path
          d="M33 80C17 68 9 54 8 38C29 45 45 57 56 72C48 74 40 77 33 80Z"
          fill="#B7EEFF"
          opacity="0.92"
        />
      </g>
      <path
        d="M50 86C82 63 114 58 149 73C132 94 101 108 67 100C60 98 54 93 50 86Z"
        fill="#27B9F4"
        opacity="0.62"
      />
      <circle cx="163" cy="72" r="10" fill="white" opacity="0.9" />
      <circle cx="164" cy="72" r="5" fill="#0F2540" />
      <path
        d="M83 49C109 35 136 39 154 58"
        stroke="white"
        strokeWidth="7"
        strokeLinecap="round"
        opacity="0.36"
      />
      <path
        d="M63 98C91 111 126 110 157 96"
        stroke="#8DE6FF"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.48"
      />
    </svg>
  );
}
