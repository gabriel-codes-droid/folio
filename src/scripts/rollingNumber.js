export const ROLL_DURATION = 240;
// Digits change no faster than this, so each roll lands before the next.
export const ROLL_INTERVAL = 260;

// Odometer-style counter: each digit has its own clipped slot, and only the
// digits that change roll. The new digit drops in from above while the old
// one rolls out below. A slot never holds more than two digits: a still-
// leaving digit is dropped the moment a newer roll starts, so fast changes
// never stack half-rolled digits on top of each other.
export function createRollingNumber(container, { reducedMotion = false, pad = 2 } = {}) {
  container.replaceChildren();
  const slots = []; // slots[0] is the ones digit
  let text = '';

  function slotAt(index) {
    while (slots.length <= index) {
      const element = document.createElement('span');
      element.className = 'roll-slot';
      container.prepend(element);
      slots.push({ element, digit: null, node: null, leaving: null });
    }
    return slots[index];
  }

  function roll(slot, digit) {
    const previous = slot.node;
    slot.leaving?.remove();
    slot.leaving = null;
    previous?.getAnimations?.().forEach(animation => animation.finish());
    const node = document.createElement('span');
    node.className = 'roll-digit';
    node.textContent = digit;
    slot.element.append(node);
    slot.node = node;
    slot.digit = digit;
    if (!previous) return;
    if (reducedMotion || !node.animate) { previous.remove(); return; }
    const timing = { duration: ROLL_DURATION, easing: 'cubic-bezier(.2,.8,.2,1)' };
    node.animate([{ transform: 'translate3d(0,-100%,0)', opacity: 0 }, { transform: 'translate3d(0,0,0)', opacity: 1 }], timing);
    const leave = previous.animate([{ transform: 'translate3d(0,0,0)', opacity: 1 }, { transform: 'translate3d(0,100%,0)', opacity: 0 }], { ...timing, fill: 'forwards' });
    slot.leaving = previous;
    leave.onfinish = () => {
      previous.remove();
      if (slot.leaving === previous) slot.leaving = null;
    };
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
