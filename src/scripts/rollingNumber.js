export const ROLL_DURATION = 320;

// Odometer-style counter: each digit has its own clipped slot, and only the
// digits that change roll. The new digit drops in from above while the old
// one rolls out below, so numbers "roll down" without overlapping.
export function createRollingNumber(container, { reducedMotion = false, pad = 2 } = {}) {
  container.replaceChildren();
  const slots = []; // slots[0] is the ones digit
  let text = '';

  function slotAt(index) {
    while (slots.length <= index) {
      const element = document.createElement('span');
      element.className = 'roll-slot';
      container.prepend(element);
      slots.push({ element, digit: null, node: null });
    }
    return slots[index];
  }

  function roll(slot, digit) {
    const previous = slot.node;
    const node = document.createElement('span');
    node.className = 'roll-digit';
    node.textContent = digit;
    slot.element.append(node);
    slot.node = node;
    slot.digit = digit;
    if (!previous) return;
    if (reducedMotion || !node.animate) { previous.remove(); return; }
    const timing = { duration: ROLL_DURATION, easing: 'cubic-bezier(.2,.8,.2,1)' };
    node.animate([{ transform: 'translate3d(0,-100%,0)' }, { transform: 'translate3d(0,0,0)' }], timing);
    const leave = previous.animate([{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(0,100%,0)' }], { ...timing, fill: 'forwards' });
    leave.onfinish = () => previous.remove();
  }

  const api = {
    get text() { return text; },
    set(value) {
      const next = String(value).padStart(pad, '0');
      if (next === text) return;
      text = next;
      for (let index = 0; index < next.length; index++) {
        const slot = slotAt(index);
        const digit = next[next.length - 1 - index];
        if (slot.digit !== digit) roll(slot, digit);
      }
    },
  };
  api.set(0);
  return api;
}
