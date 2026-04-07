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
