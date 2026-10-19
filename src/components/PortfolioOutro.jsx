import { useEffect, useRef, useState } from 'react';
import SonarGrid from './SonarGrid';
import '../styles/contact.css';

const profiles = [
  { index: '01', name: 'EMAIL', label: 'DIRECT LINE', description: 'Start a conversation about a project or opportunity.', action: 'SEND EMAIL', href: 'mailto:nmandrakegabriel@gmail.com', external: false },
  { index: '02', name: 'GITHUB', label: 'CODE / SYSTEMS', description: 'Explore the code, experiments, and products behind the work.', action: 'OPEN GITHUB', href: 'https://github.com/gabriel-codes-droid', external: true },
  { index: '03', name: 'INSTAGRAM', label: 'VISUAL NOTES', description: 'Follow the visual experiments and ideas outside the portfolio.', action: 'OPEN INSTAGRAM', href: 'https://www.instagram.com/jus__gabriel/?utm_source=ig_web_button_share_sheet', external: true },
];
// Official Devicon marks (MIT), served as files so their gradient ids never collide.
const technologies = [
  { name: 'React', logo: 'react' }, { name: 'Tailwind CSS', logo: 'tailwindcss' },
  { name: 'TypeScript', logo: 'typescript' }, { name: 'CSS', logo: 'css3' },
  { name: 'JavaScript', logo: 'javascript' }, { name: 'Java', logo: 'java' },
  { name: 'C++', logo: 'cplusplus' }, { name: 'C', logo: 'c' },
  { name: 'Python', logo: 'python' }, { name: 'Node.js', logo: 'nodejs' },
  { name: 'Express', logo: 'express', mono: true },
];
export default function PortfolioOutro() {
  const [activeProfile, setActiveProfile] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeState, setComposeState] = useState('idle');
  const composeRef = useRef(null);
  const moveProfile = (direction) => setActiveProfile(current => (current + direction + profiles.length) % profiles.length);
  const openCompose = () => {
    setComposeState('idle');
    setComposeOpen(true);
  };

  useEffect(() => {
    if (!composeOpen) return undefined;
    const trigger = document.activeElement;
    const dialog = composeRef.current;
    dialog?.querySelector('input[type="email"]')?.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setComposeOpen(false);
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not([tabindex="-1"]), textarea, a[href]')];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [composeOpen]);

  const submitMessage = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setComposeState('sending');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          message: data.get('message'),
          website: data.get('website'),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The message could not be sent.');
      form.reset();
      setComposeState('sent');
    } catch {
      setComposeState('error');
    }
  };

  return <div className="editorial lower-content">
    <SonarGrid background />
    <section aria-labelledby="tech-heading"><div className="wrap"><p className="eyebrow">04 / TECH STACK</p><h2 id="tech-heading">TOOLS I BUILD WITH.</h2></div>
      <div className="tech-marquee"><div className="tech-track">{[0, 1].map(copy => <div key={copy} aria-hidden={copy === 1}>{technologies.map(({ name, logo, mono }) => <span key={name}><img className={mono ? 'is-mono' : undefined} src={`/logos/${logo}.svg`} alt="" width="40" height="40" decoding="async" draggable="false"/>{name}</span>)}</div>)}</div></div>
    </section>
    <section className="contact-section wrap" id="contact" aria-labelledby="contact-heading">
      <p className="eyebrow">05 / LET’S TALK</p>
      <h2 id="contact-heading">LET’S BUILD<br/>SOMETHING.</h2>
      <p className="contact-intro">Have a project in mind? Let’s talk about it.</p>
      <button
        type="button"
        className="contact-email"
        onClick={openCompose}
        aria-label="Write a message to nmandrakegabriel@gmail.com"
        aria-haspopup="dialog"
        aria-expanded={composeOpen}
        aria-controls={composeOpen ? 'contact-compose-dialog' : undefined}
      >
        <span className="contact-email-address">nmandrakegabriel<wbr/>@gmail.com</span>
        <span className="contact-arrow" aria-hidden="true">↗</span>
      </button>
      <div
        className="contact-card-stack"
        role="region"
        aria-label="Contact links"
        tabIndex="0"
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft') { event.preventDefault(); moveProfile(-1); }
          if (event.key === 'ArrowRight') { event.preventDefault(); moveProfile(1); }
        }}
      >
        <div className="contact-card-stage">
          {profiles.map((profile, index) => {
            let offset = (index - activeProfile + profiles.length) % profiles.length;
            if (offset > Math.floor(profiles.length / 2)) offset -= profiles.length;
            const active = offset === 0;
            const distance = Math.abs(offset);
            const style = {
              zIndex: 10 - distance,
              '--card-x': `${offset * 42}%`,
              '--card-y': `${distance * 12}px`,
              '--card-z': `${-distance * 92}px`,
              '--card-rotate': `${offset * 7}deg`,
              '--card-scale': active ? '1' : '.9',
              '--card-opacity': active ? '1' : '.54',
            };
            return <article key={profile.name} className={`contact-card${active ? ' is-active' : ''}`} style={style}>
              <button
                type="button"
                className="contact-card-select"
                onClick={() => setActiveProfile(index)}
                aria-label={`Select ${profile.name} card`}
                aria-pressed={active}
              >
                <span className="contact-card-top"><span>{profile.index}</span><span aria-hidden="true">↗</span></span>
                <span className="contact-card-label">{profile.label}</span>
                <strong>{profile.name}</strong>
                <span className="contact-card-description">{profile.description}</span>
              </button>
              <a
                className="contact-card-action"
                href={profile.href}
                target={profile.external ? '_blank' : undefined}
                rel={profile.external ? 'noopener noreferrer' : undefined}
                tabIndex={active ? 0 : -1}
                aria-hidden={!active}
                aria-label={`${profile.action}${profile.external ? ' (opens in a new tab)' : ''}`}
              >{profile.action} <span aria-hidden="true">↗</span></a>
            </article>;
          })}
        </div>
        <div className="contact-card-controls" aria-label="Contact card navigation">
          <button type="button" onClick={() => moveProfile(-1)} aria-label="Previous contact card">←</button>
          <div className="contact-card-dots">
            {profiles.map((profile, index) => <button
              key={profile.name}
              type="button"
              className={index === activeProfile ? 'is-active' : ''}
              onClick={() => setActiveProfile(index)}
              aria-label={`Show ${profile.name}`}
              aria-pressed={index === activeProfile}
            />)}
          </div>
          <button type="button" onClick={() => moveProfile(1)} aria-label="Next contact card">→</button>
        </div>
      </div>
      {composeOpen && <div
        className="compose-backdrop"
        role="presentation"
        onMouseDown={event => { if (event.target === event.currentTarget) setComposeOpen(false); }}
      >
        <div ref={composeRef} id="contact-compose-dialog" className="compose-dialog" role="dialog" aria-modal="true" aria-labelledby="compose-heading">
          <div className="compose-header">
            <div><p className="compose-kicker">DIRECT LINE</p><h3 id="compose-heading">SEND A MESSAGE</h3></div>
            <button type="button" className="compose-close" onClick={() => setComposeOpen(false)} aria-label="Close message form">×</button>
          </div>
          <p className="compose-intro">Your message will be delivered to Gabriel’s inbox. Replies go directly to your email.</p>
          <form className="compose-form" onSubmit={submitMessage}>
            <label htmlFor="compose-email">YOUR EMAIL</label>
            <input id="compose-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
            <label htmlFor="compose-message">MESSAGE / PROJECT DETAILS</label>
            <textarea id="compose-message" name="message" rows="5" minLength="10" maxLength="5000" placeholder="Tell me what you’re building…" required />
            <input className="compose-honeypot" name="website" tabIndex="-1" autoComplete="off" aria-hidden="true" />
            <button className="compose-submit" type="submit" disabled={composeState === 'sending'}>
              {composeState === 'sending' ? 'SENDING…' : 'SEND MESSAGE ↗'}
            </button>
          </form>
          {composeState === 'sent' && <p className="compose-feedback is-success" role="status">Message sent. Thanks for reaching out.</p>}
          {composeState === 'error' && <p className="compose-feedback is-error" role="alert">The message could not be sent right now. Please try again in a moment.</p>}
        </div>
      </div>}
    </section>
    <footer className="footer wrap"><div><a className="wordmark" href="#top">N.MANDRAKE GABRIEL</a><p>Built with Astro / React / Three.js / GSAP.</p></div><a href="#top">BACK TO TOP ↑</a></footer>
  </div>;
}
