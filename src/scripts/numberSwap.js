export const SWAP_DURATION = 240;
export const SWAP_INTERVAL = 110;

// The whole number is replaced: the new value rises in from below while the
// previous one leaves upward. Only one outgoing value exists at a time, so
// rapid jumps (e.g. 37 -> 52) never pile up stale layers.
export function createNumberSwap(container, reducedMotion = false) {
  container.replaceChildren();
  const sizer = document.createElement('span');
  sizer.className = 'boot-number-sizer';
  sizer.textContent = '100';
  container.append(sizer);
  const make = value => {
    const element = document.createElement('span');
    element.className = 'boot-number-value';
    element.textContent = String(value);
    container.append(element);
    return element;
  };
  let current = make(0);
  let value = 0;
  let outgoing = null;
  const easing = 'cubic-bezier(.2,.8,.2,1)';
  return {
    get value() { return value; },
    set(next) {
      if (next === value) return;
      value = next;
      outgoing?.remove();
      outgoing = null;
      const previous = current;
      current = make(next);
      if (reducedMotion || !current.animate) { previous.remove(); return; }
      outgoing = previous;
      current.animate([
        { transform: 'translate3d(0, 62%, 0)', opacity: 0 },
        { transform: 'translate3d(0, 0, 0)', opacity: 1 },
      ], { duration: SWAP_DURATION, easing });
      const leave = previous.animate([
        { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        { transform: 'translate3d(0, -62%, 0)', opacity: 0 },
      ], { duration: SWAP_DURATION, easing, fill: 'forwards' });
      leave.onfinish = () => {
        previous.remove();
        if (outgoing === previous) outgoing = null;
      };
    },
    dispose() { container.getAnimations?.({ subtree: true }).forEach(animation => animation.cancel()); },
  };
}
