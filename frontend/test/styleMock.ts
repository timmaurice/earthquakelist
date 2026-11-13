// Stands in for the .scss/.css imports that rollup turns into Lit styles. It has to be a
// CSSResult: jsdom 31 rejects anything but a CSSStyleSheet in `adoptedStyleSheets`, and a bare
// string has no `styleSheet` for Lit to hand over.
import { unsafeCSS } from 'lit';

export default unsafeCSS('');
