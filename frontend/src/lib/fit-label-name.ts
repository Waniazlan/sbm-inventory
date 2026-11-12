// Measure the rendered label so preview and print use the same available space.
export function fitLabelName(label: HTMLElement) {
  const name = label.querySelector<HTMLElement>(".label-name");
  if (!name) return;
  const view = label.ownerDocument.defaultView!;
  name.style.removeProperty("font-size");
  name.style.removeProperty("max-height");
  const style = view.getComputedStyle(label);
  const nameStyle = view.getComputedStyle(name);
  const maxFontSize = parseFloat(nameStyle.fontSize);
  const qrLayout = label.classList.contains("barcode-sticker-qr");
  const siblings = Array.from(label.children).filter(
    (child) =>
      child !== name && !(qrLayout && child.classList.contains("label-symbol")),
  );
  const availableHeight =
    label.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom) -
    siblings.reduce(
      (sum, child) => sum + child.getBoundingClientRect().height,
      0,
    ) -
    parseFloat(style.rowGap) * siblings.length;
  // Use up to three lines, shrinking only when the complete name needs it.
  name.style.maxHeight = `${Math.max(1, Math.min(availableHeight, parseFloat(nameStyle.lineHeight) * 3))}px`;
  const fits = () =>
    name.scrollWidth <= name.clientWidth &&
    name.scrollHeight <= name.clientHeight;
  if (fits()) return;
  let low = 1;
  let high = Math.floor(maxFontSize * 10);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    name.style.fontSize = `${middle / 10}px`;
    if (fits()) low = middle;
    else high = middle - 1;
  }
  name.style.fontSize = `${low / 10}px`;
}
