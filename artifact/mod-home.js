/* mod-home.js — 화면 home: 제목 한 줄 + 통합 검색창(제출 → explore) + 바로 가기 3개.
   최근 공개된 연구는 explore에서 검색어가 없을 때 보여 준다. */
(function () {
  "use strict";
  const RN = window.RN;
  if (!RN) return;
  const { h } = RN;

  RN.css("home", `
    .home-hero { position: relative; display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center; padding: clamp(28px, 11vh, 104px) 0 clamp(20px, 6vh, 56px); width: 100%; }
    /* 모눈 노트: 가운데에서 바깥으로 옅어지는 점 격자 */
    .home-hero::before { content: ""; position: absolute; inset: 0; z-index: -1; background-image: radial-gradient(var(--line) 1.2px, transparent 1.2px); background-size: 22px 22px; -webkit-mask-image: radial-gradient(ellipse 70% 80% at 50% 40%, #000 30%, transparent 75%); mask-image: radial-gradient(ellipse 70% 80% at 50% 40%, #000 30%, transparent 75%); }
    .home-hero h1 { font-size: clamp(1.7rem, 5.4vw, 2.7rem); line-height: 1.3; max-width: 12em; }
    .home-lead { color: var(--muted); max-width: 34em; font-size: 1.02rem; }
    .home-search { display: flex; align-items: center; gap: 6px; width: 100%; max-width: 580px; padding: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; box-shadow: var(--shadow); }
    .home-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
    .home-search input[type="search"] { flex: 1; font-size: 1.02rem; padding: 9px 14px; border: 0; background: none; box-shadow: none; border-radius: 999px; }
    .home-search input[type="search"]:focus { box-shadow: none; }
    .home-search .rn-btn { border-radius: 999px; padding: 9px 22px; font-size: 0.95rem; }
    .home-stats { font-family: var(--font-mono); font-size: 0.8rem; color: var(--muted); min-height: 1.4em; }
    .home-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%; max-width: 760px; margin: 0 auto; }
    .home-link { display: flex; flex-direction: column; gap: 4px; text-align: left; text-decoration: none; color: var(--fg); padding: 16px 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .home-link:hover { border-color: var(--accent); box-shadow: var(--shadow); }
    .home-link b { font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
    .home-link b::after { content: "→"; color: var(--accent); }
    .home-link span { color: var(--muted); font-size: 0.86rem; line-height: 1.5; }
    .home-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (max-width: 620px) { .home-links { grid-template-columns: minmax(0, 1fr); } .home-search .rn-btn { padding: 9px 16px; } }
    @media (prefers-reduced-motion: no-preference) { .home-link { transition: border-color 0.12s, box-shadow 0.12s; } }
  `);

  RN.view("home", {
    title: "처음",
    mount(root) {
      const input = h("input", { type: "search", id: "home-q", name: "q", placeholder: "키워드로 연구·고충 찾기 (예: 음향 블랙홀)", autocomplete: "off" });
      const form = h("form", { class: "home-search", role: "search", onsubmit: (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) { input.focus(); return; }
        RN.go("explore", { q });
      } },
      h("label", { for: "home-q", class: "home-sr" }, "연구·고충 검색"),
      input,
      h("button", { type: "submit", class: "rn-btn rn-primary" }, "검색"));

      const link = (title, text, view) => h("a", { href: "#" + view, class: "home-link", onclick: (e) => { e.preventDefault(); RN.go(view); } },
        h("b", {}, title), h("span", {}, text));
      const stats = h("p", { class: "home-stats", "aria-live": "polite" });

      root.append(
        h("section", { class: "home-hero" },
          h("h1", {}, "비슷한 연구를 찾고, ", h("mark", {}, "막힌 점"), "을 나눠요"),
          h("p", { class: "home-lead" }, "먼저 해 본 사람의 한계와 고충을 읽고, 내 보고서는 여기서 바로 씁니다."),
          form,
          stats),
        h("nav", { class: "home-links", "aria-label": "바로 가기" },
          link("연구 탐색", "공개된 연구의 요약과 한계, 결과보고서", "explore"),
          link("고충 게시판", "실험하다 막힌 점을 묻고 답하기", "pains"),
          link("내 프로젝트", "보고서 쓰기, 표·그래프, 연구 공개", "projects")));

      // 실제 데이터 개수 (공유 DB를 읽은 뒤에만 표시)
      return RN.onShared((shared) => {
        const ready = shared.loaded.research && shared.loaded.pains && !shared.error;
        stats.textContent = ready ? `연구 ${shared.research.length}건 · 고충 ${shared.pains.length}건` : "";
      });
    },
  });
})();
