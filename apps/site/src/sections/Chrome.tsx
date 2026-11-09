import { NAV, STATUS } from "../content";

/* Fold 00 · chrome.
   A 30px status bar over a 64px nav. The bar carries only statements that are true;
   a marketing page that invents a telemetry readout has shipped a mockup. */
export function Chrome() {
  return (
    <>
      <div className="statusbar" role="presentation">
        <div className="statusbar-in">
          <span className="sb-cell sb-live">
            <i className="sb-dot" aria-hidden="true" />
            Sharedock
          </span>
          {STATUS.map((s) => (
            <span className="sb-cell" key={s}>
              {s}
            </span>
          ))}
        </div>
      </div>

      <header className="nav">
        <div className="nav-in">
          <a className="nav-mark" href="#top" aria-label="Sharedock, home">
            <img src="./brand/wordmark.png" alt="Sharedock" width={132} height={27} />
          </a>

          <nav className="nav-links" aria-label="Main">
            {NAV.links.map((l) => (
              <a className="lnk nav-link" href={l.href} key={l.href}>
                {l.label}
              </a>
            ))}
          </nav>

          {/* Secondary here on purpose. The hero owns the one primary button, and the
              two are never in the same viewport. */}
          <a className="btn btn-secondary btn-sm nav-cta" href="#pricing">
            {NAV.cta}
          </a>
        </div>
      </header>
    </>
  );
}
