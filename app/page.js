// Home page.
//
// Static page chrome (header + footer) is server-rendered here; the interactive
// games browser — date nav, country picker, league filters, search, the match
// cards and the detail modal — lives in the GamesBrowser client island mounted
// inside <main>.

import GamesBrowser from "@/components/GamesBrowser";

export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="./">
            <span className="brand-ball">⚽</span>
            <span className="brand-name">
              Hoje Há <span>Bola</span>
            </span>
          </a>
          <p className="tagline">Football worldwide &amp; where to watch it</p>
        </div>
      </header>

      <main className="container">
        <GamesBrowser />
      </main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-about">
            <a className="footer-brand" href="./">
              <span className="brand-ball">⚽</span>
              <span className="brand-name">
                Hoje Há <span>Bola</span>
              </span>
            </a>
            <p id="footer-data" className="footer-data">
              Today's football from around the world and where to watch it — live
              on TV and streaming, wherever you are.
            </p>
          </div>

          <nav className="footer-col" aria-labelledby="footer-site-title">
            <h2 id="footer-site-title" className="footer-heading">
              Site
            </h2>
            <ul className="footer-links">
              <li>
                <a href="#" id="ad-prefs">
                  Ad preferences
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="footer-bottom">
          <div className="container">
            <p id="footer-copy">© 2026 Hoje Há Bola · All rights reserved.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
