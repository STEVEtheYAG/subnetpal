/* SubnetPal Lab: the FortiOS 8.0.2 mock GUI (lab/index.html) runs in an iframe on the Lab tab.
   The iframe keeps its CSS and JS fully separate from SubnetPal. "Send to Lab" types SubnetPal's CLI
   into the mock's CLI console through the hook the mock exposes (window.__fm.cli.open/run). */
(function (root) {
  'use strict';
  // Lines the console should run: no blanks, no # comment lines, tabs as spaces (same rules as the mock's own paste).
  function linesFor(text) {
    return String(text || '').split(/\r\n|\r|\n/).map(l => l.replace(/\t/g, ' ').replace(/\s+$/, '')).filter(l => l.trim() && !l.trim().startsWith('#'));
  }
  // Wait (up to ~10 s) until the mock in the iframe has loaded its CLI hook.
  function ready(frame) {
    return new Promise((resolve, reject) => {
      let n = 0;
      const tick = () => {
        let cli = null;
        try { cli = frame.contentWindow && frame.contentWindow.__fm && frame.contentWindow.__fm.cli; } catch (e) { cli = null; }
        if (cli && cli.run) return resolve(cli);
        if (++n > 100) return reject(new Error('The Lab did not load.'));
        setTimeout(tick, 100);
      };
      tick();
    });
  }
  // Load the mock on first use only (it is ~430 KB), then return it ready.
  function load(frame) {
    if (!frame.getAttribute('src')) frame.setAttribute('src', frame.dataset.src || 'lab/index.html');
    return ready(frame);
  }
  // Run every line in the mock's CLI console. Resolves with the number of lines sent.
  function send(frame, text) {
    const lines = linesFor(text);
    if (!lines.length) return Promise.resolve(0);
    return load(frame).then(cli => { cli.open(); lines.forEach(l => cli.run(l)); return lines.length; });
  }
  const Lab = { linesFor, ready, load, send };
  if (typeof module !== 'undefined' && module.exports) module.exports = Lab; else root.Lab = Lab;
})(this);
