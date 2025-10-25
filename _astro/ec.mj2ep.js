try{(()=>{function a(e){if(!e)return;let t=e.getAttribute("tabindex")!==null,r=e.scrollWidth>e.clientWidth;r&&!t?(e.setAttribute("tabindex","0"),e.setAttribute("role","region")):!r&&t&&(e.removeAttribute("tabindex"),e.removeAttribute("role"))}var u=window.requestIdleCallback||(e=>setTimeout(e,1)),s=window.cancelIdleCallback||clearTimeout;function l(e){let t=new Set,r,n;return new ResizeObserver(c=>{c.forEach(o=>t.add(o.target)),r&&clearTimeout(r),n&&s(n),r=setTimeout(()=>{n&&s(n),n=u(()=>{t.forEach(o=>e(o)),t.clear()})},250)})}function i(e,t){e.querySelectorAll?.(".expressive-code pre > code").forEach(r=>{let n=r.parentElement;n&&t.observe(n)})}var d=l(a);i(document,d);var b=new MutationObserver(e=>e.forEach(t=>t.addedNodes.forEach(r=>{i(r,d)})));b.observe(document.body,{childList:!0,subtree:!0});document.addEventListener("astro:page-load",()=>{i(document,d)});})();}catch(e){console.error("[EC] tabindex-js-module failed:",e)}
window.addEventListener("click", event2 => {
  const {target} = event2;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  ;
  copypaste(target);
}, {
  capture: true
});
window.addEventListener("click", event2 => {
  const {target} = event2;
  let element = target;
  console.log("click");
  element = element.closest?.("[data-pardon-paste-target]");
  if (element?.hasAttribute?.("data-pardon-paste-target")) {
    const targetid = element.getAttribute("data-pardon-paste-target");
    const into = element.getAttribute("data-pardon-paste-to");
    const code = element.getAttribute("data-pardon-paste-code");
    const clear = element.getAttribute("data-pardon-paste-clear")?.split(",") ?? [];
    pasteinto(document.getElementById(targetid), into, code, {
      clear
    });
  }
  ;
  copypaste(target);
});
document.addEventListener("DOMContentLoaded", () => {
  const StarlightTabsPrototype = customElements.get("starlight-tabs")?.prototype;
  if (StarlightTabsPrototype) {
    StarlightTabsPrototype.switchTab = (original => function (...args) {
      const {id} = args[0];
      const panelId = id.replace(/^tab-/, "tab-panel-");
      const panel = document.getElementById(panelId);
      const autocopy = panel?.querySelector("[data-autocopy]");
      if (autocopy instanceof HTMLButtonElement) {
        copypaste(autocopy);
      }
      ;
      return original.apply(this, args);
    })(StarlightTabsPrototype.switchTab);
  }
});
function pasteinto(context, copyTo, code, options) {
  const pasteTarget = (context?.matches(`[data-pardon-${copyTo}]`) ? context : void 0) ?? context?.querySelector(`[data-pardon-${copyTo}]`);
  pasteTarget?.pardonPlayground?.update(code, options);
}
function copypaste(target) {
  if (target.classList.contains("copypaste")) {
    event.stopImmediatePropagation();
    const code = target.getAttribute("data-code")?.replace(/\u007f/g, "\n");
    const clear = (target.getAttribute("data-clear") ?? "").split(",").filter(Boolean);
    const copyTo = target.getAttribute("data-copy");
    if (copyTo) {
      pasteinto(target.closest(`.copypaste-context`), copyTo, code, {
        clear
      });
    }
  }
}