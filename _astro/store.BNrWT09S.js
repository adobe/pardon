import{$,c as q,n as C,o as z,p as T}from"./web.CMqC0Jm1.js";const E=Symbol("store-raw"),P=Symbol("store-node"),b=Symbol("store-has"),I=Symbol("store-self");function L(n){let e=n[$];if(!e&&(Object.defineProperty(n,$,{value:e=new Proxy(n,X)}),!Array.isArray(n))){const o=Object.keys(n),l=Object.getOwnPropertyDescriptors(n);for(let f=0,i=o.length;f<i;f++){const c=o[f];l[c].get&&Object.defineProperty(n,c,{enumerable:l[c].enumerable,get:l[c].get.bind(e)})}}return e}function y(n){let e;return n!=null&&typeof n=="object"&&(n[$]||!(e=Object.getPrototypeOf(n))||e===Object.prototype||Array.isArray(n))}function g(n,e=new Set){let o,l,f,i;if(o=n!=null&&n[E])return o;if(!y(n)||e.has(n))return n;if(Array.isArray(n)){Object.isFrozen(n)?n=n.slice(0):e.add(n);for(let c=0,d=n.length;c<d;c++)f=n[c],(l=g(f,e))!==f&&(n[c]=l)}else{Object.isFrozen(n)?n=Object.assign({},n):e.add(n);const c=Object.keys(n),d=Object.getOwnPropertyDescriptors(n);for(let u=0,r=c.length;u<r;u++)i=c[u],!d[i].get&&(f=n[i],(l=g(f,e))!==f&&(n[i]=l))}return n}function N(n,e){let o=n[e];return o||Object.defineProperty(n,e,{value:o=Object.create(null)}),o}function K(n,e,o){if(n[e])return n[e];const[l,f]=q(o,{equals:!1,internal:!0});return l.$=f,n[e]=l}function H(n,e){const o=Reflect.getOwnPropertyDescriptor(n,e);return!o||o.get||!o.configurable||e===$||e===P||(delete o.value,delete o.writable,o.get=()=>n[$][e]),o}function M(n){T()&&K(N(n,P),I)()}function V(n){return M(n),Reflect.ownKeys(n)}const X={get(n,e,o){if(e===E)return n;if(e===$)return o;if(e===z)return M(n),o;const l=N(n,P),f=l[e];let i=f?f():n[e];if(e===P||e===b||e==="__proto__")return i;if(!f){const c=Object.getOwnPropertyDescriptor(n,e);T()&&(typeof i!="function"||n.hasOwnProperty(e))&&!(c&&c.get)&&(i=K(l,e,i)())}return y(i)?L(i):i},has(n,e){return e===E||e===$||e===z||e===P||e===b||e==="__proto__"?!0:(T()&&K(N(n,b),e)(),e in n)},set(){return!0},deleteProperty(){return!0},ownKeys:V,getOwnPropertyDescriptor:H};function h(n,e,o,l=!1){if(!l&&n[e]===o)return;const f=n[e],i=n.length;o===void 0?(delete n[e],n[b]&&n[b][e]&&f!==void 0&&n[b][e].$()):(n[e]=o,n[b]&&n[b][e]&&f===void 0&&n[b][e].$());let c=N(n,P),d;if((d=K(c,e,f))&&d.$(()=>o),Array.isArray(n)&&n.length!==i){for(let u=n.length;u<i;u++)(d=c[u])&&d.$();(d=K(c,"length",i))&&d.$(n.length)}(d=c[I])&&d.$()}function W(n,e){const o=Object.keys(e);for(let l=0;l<o.length;l+=1){const f=o[l];h(n,f,e[f])}}function Y(n,e){if(typeof e=="function"&&(e=e(n)),e=g(e),Array.isArray(e)){if(n===e)return;let o=0,l=e.length;for(;o<l;o++){const f=e[o];n[o]!==f&&h(n,o,f)}h(n,"length",l)}else W(n,e)}function D(n,e,o=[]){let l,f=n;if(e.length>1){l=e.shift();const c=typeof l,d=Array.isArray(n);if(Array.isArray(l)){for(let u=0;u<l.length;u++)D(n,[l[u]].concat(e),o);return}else if(d&&c==="function"){for(let u=0;u<n.length;u++)l(n[u],u)&&D(n,[u].concat(e),o);return}else if(d&&c==="object"){const{from:u=0,to:r=n.length-1,by:s=1}=l;for(let t=u;t<=r;t+=s)D(n,[t].concat(e),o);return}else if(e.length>1){D(n[l],e,[l].concat(o));return}f=n[l],o=[l].concat(o)}let i=e[0];typeof i=="function"&&(i=i(f,o),i===f)||l===void 0&&i==null||(i=g(i),l===void 0||y(f)&&y(i)&&!Array.isArray(i)?W(f,i):h(n,l,i))}function G(...[n,e]){const o=g(n||{}),l=Array.isArray(o),f=L(o);function i(...c){C(()=>{l&&c.length===1?Y(o,c[0]):D(o,c)})}return[f,i]}const F=Symbol("store-root");function S(n,e,o,l,f){const i=e[o];if(n===i)return;const c=Array.isArray(n);if(o!==F&&(!y(n)||!y(i)||c!==Array.isArray(i)||f&&n[f]!==i[f])){h(e,o,n);return}if(c){if(n.length&&i.length&&(!l||f&&n[0]&&n[0][f]!=null)){let r,s,t,A,O,w,a,j;for(t=0,A=Math.min(i.length,n.length);t<A&&(i[t]===n[t]||f&&i[t]&&n[t]&&i[t][f]===n[t][f]);t++)S(n[t],i,t,l,f);const _=new Array(n.length),R=new Map;for(A=i.length-1,O=n.length-1;A>=t&&O>=t&&(i[A]===n[O]||f&&i[A]&&n[O]&&i[A][f]===n[O][f]);A--,O--)_[O]=i[A];if(t>O||t>A){for(s=t;s<=O;s++)h(i,s,n[s]);for(;s<n.length;s++)h(i,s,_[s]),S(n[s],i,s,l,f);i.length>n.length&&h(i,"length",n.length);return}for(a=new Array(O+1),s=O;s>=t;s--)w=n[s],j=f&&w?w[f]:w,r=R.get(j),a[s]=r===void 0?-1:r,R.set(j,s);for(r=t;r<=A;r++)w=i[r],j=f&&w?w[f]:w,s=R.get(j),s!==void 0&&s!==-1&&(_[s]=i[r],s=a[s],R.set(j,s));for(s=t;s<n.length;s++)s in _?(h(i,s,_[s]),S(n[s],i,s,l,f)):h(i,s,n[s])}else for(let r=0,s=n.length;r<s;r++)S(n[r],i,r,l,f);i.length>n.length&&h(i,"length",n.length);return}const d=Object.keys(n);for(let r=0,s=d.length;r<s;r++)S(n[d[r]],i,d[r],l,f);const u=Object.keys(i);for(let r=0,s=u.length;r<s;r++)n[u[r]]===void 0&&h(i,u[r],void 0)}function J(n,e={}){const{merge:o,key:l="id"}=e,f=g(n);return i=>{if(!y(i)||!y(f))return f;const c=S(f,{[F]:i},F,o,l);return c===void 0?i:c}}export{G as c,J as r};
