/*
 * Shared top bar + hamburger drawer for the /admin console pages.
 *
 * Each page just links this script; it injects a sticky top bar with a
 * hamburger button, a slide-in drawer linking the admin pages, and highlights
 * the current one. No framework — the admin surface is plain static HTML.
 */
(function () {
  "use strict";
  var PAGES = [
    { href: "/admin", label: "Connections debug" },
    { href: "/admin/overrides", label: "TV overrides" },
    { href: "/admin/seo", label: "pSEO / sitemap" },
    { href: "/admin/ads", label: "Manage ads" },
  ];

  var path = location.pathname.replace(/\/+$/, "") || "/admin";
  var current = PAGES.filter(function (p) { return p.href === path; })[0] || PAGES[0];

  var bar = document.createElement("div");
  bar.className = "admin-topbar";

  var burger = document.createElement("button");
  burger.className = "admin-burger";
  burger.type = "button";
  burger.setAttribute("aria-label", "Menu");
  burger.setAttribute("aria-expanded", "false");
  burger.innerHTML = "<span></span><span></span><span></span>";

  var title = document.createElement("div");
  title.className = "admin-title";
  title.innerHTML = "Hoje Há <b>Bola</b> · " + current.label;

  bar.appendChild(burger);
  bar.appendChild(title);

  var drawer = document.createElement("nav");
  drawer.className = "admin-drawer";
  drawer.setAttribute("aria-label", "Admin");
  var head = document.createElement("div");
  head.className = "admin-drawer-head";
  head.innerHTML = "Hoje Há <b>Bola</b> · Admin";
  drawer.appendChild(head);
  PAGES.forEach(function (p) {
    var a = document.createElement("a");
    a.href = p.href;
    a.textContent = p.label;
    if (p.href === path) a.className = "active";
    drawer.appendChild(a);
  });

  var backdrop = document.createElement("div");
  backdrop.className = "admin-backdrop";

  function setOpen(open) {
    document.body.classList.toggle("admin-nav-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  burger.addEventListener("click", function () {
    setOpen(!document.body.classList.contains("admin-nav-open"));
  });
  backdrop.addEventListener("click", function () { setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setOpen(false);
  });

  document.body.insertBefore(bar, document.body.firstChild);
  document.body.appendChild(drawer);
  document.body.appendChild(backdrop);
})();
