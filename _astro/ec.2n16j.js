try{(()=>{function a(e){if(!e)return;let t=e.getAttribute("tabindex")!==null,n=e.scrollWidth>e.clientWidth;n&&!t?e.setAttribute("tabindex","0"):!n&&t&&e.removeAttribute("tabindex")}var u=window.requestIdleCallback||(e=>setTimeout(e,1)),i=window.cancelIdleCallback||clearTimeout;function l(e){let t=new Set,n,r;return new ResizeObserver(c=>{c.forEach(o=>t.add(o.target)),n&&clearTimeout(n),r&&i(r),n=setTimeout(()=>{r&&i(r),r=u(()=>{t.forEach(o=>e(o)),t.clear()})},250)})}function d(e,t){e.querySelectorAll?.(".expressive-code pre > code").forEach(n=>{let r=n.parentElement;r&&t.observe(r)})}var s=l(a);d(document,s);var b=new MutationObserver(e=>e.forEach(t=>t.addedNodes.forEach(n=>{d(n,s)})));b.observe(document.body,{childList:!0,subtree:!0});document.addEventListener("astro:page-load",()=>{d(document,s)});})();}catch(e){console.error("[EC] tabindex-js-module failed:",e)}
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