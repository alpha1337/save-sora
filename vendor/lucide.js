const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_ICON_ATTRIBUTES = {
  xmlns: SVG_NS,
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

export const FullscreenIcon = [
  ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
  ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
  ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
  ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
  ["rect", { width: "10", height: "8", x: "7", y: "8", rx: "1" }],
];

export const PictureInPicture2Icon = [
  ["path", { d: "M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" }],
  ["rect", { width: "10", height: "7", x: "12", y: "13", rx: "2" }],
];

export const PencilIcon = [
  ["path", { d: "M12 20h9" }],
  ["path", { d: "M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" }],
];

export const ArrowUpFromLineIcon = [
  ["path", { d: "M18 9l-6-6-6 6" }],
  ["path", { d: "M12 3v14" }],
  ["path", { d: "M5 21h14" }],
];

export const CircleChevronUpIcon = [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["path", { d: "m8 14 4-4 4 4" }],
];

export const MoonIcon = [
  ["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9" }],
];

export const SunIcon = [
  ["circle", { cx: "12", cy: "12", r: "4" }],
  ["path", { d: "M12 2v2" }],
  ["path", { d: "M12 20v2" }],
  ["path", { d: "m4.93 4.93 1.41 1.41" }],
  ["path", { d: "m17.66 17.66 1.41 1.41" }],
  ["path", { d: "M2 12h2" }],
  ["path", { d: "M20 12h2" }],
  ["path", { d: "m6.34 17.66-1.41 1.41" }],
  ["path", { d: "m19.07 4.93-1.41 1.41" }],
];

export const ArchiveIcon = [
  ["rect", { x: "3", y: "4", width: "18", height: "4", rx: "1" }],
  ["path", { d: "M5 8h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" }],
  ["path", { d: "M10 12h4" }],
];

export const ArchiveRestoreIcon = [
  ["rect", { x: "3", y: "4", width: "18", height: "4", rx: "1" }],
  ["path", { d: "M5 8h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" }],
  ["path", { d: "M12 17v-5" }],
  ["path", { d: "m9.5 14.5 2.5-2.5 2.5 2.5" }],
];

export const CalendarIcon = [
  ["path", { d: "M8 2v4" }],
  ["path", { d: "M16 2v4" }],
  ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2" }],
  ["path", { d: "M3 10h18" }],
];

export const HardDriveDownloadIcon = [
  ["path", { d: "M12 2v8" }],
  ["path", { d: "m8 6 4 4 4-4" }],
  ["rect", { x: "3", y: "14", width: "18", height: "8", rx: "2" }],
  ["path", { d: "M7 18h.01" }],
  ["path", { d: "M11 18h2" }],
];

export function createLucideIcon(iconNode, options = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  const className = typeof options.className === "string" ? options.className.trim() : "";
  const label = typeof options.label === "string" ? options.label.trim() : "";
  const size = Number.isFinite(Number(options.size)) ? String(Number(options.size)) : null;

  for (const [attributeName, attributeValue] of Object.entries(DEFAULT_ICON_ATTRIBUTES)) {
    svg.setAttribute(attributeName, attributeValue);
  }

  if (size) {
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
  }

  if (className) {
    svg.setAttribute("class", className);
  }

  if (label) {
    svg.setAttribute("aria-label", label);
    svg.setAttribute("role", "img");
  } else {
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
  }

  for (const [tagName, attributes] of Array.isArray(iconNode) ? iconNode : []) {
    const child = document.createElementNS(SVG_NS, tagName);
    for (const [attributeName, attributeValue] of Object.entries(attributes || {})) {
      child.setAttribute(attributeName, attributeValue);
    }
    svg.append(child);
  }

  return svg;
}
