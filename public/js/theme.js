'use strict';
/* Light/dark theme: 'auto' follows the operating system. Loaded in <head> so the first paint is right. */
(function () {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const get = () => { try { return localStorage.getItem('plcf.theme') || 'auto'; } catch (e) { return 'auto'; } };
  const apply = () => {
    const pref = get(), t = pref === 'auto' ? (mq.matches ? 'dark' : 'light') : pref;
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.themePref = pref;
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#111317' : '#f6f7f9';
    window.dispatchEvent(new CustomEvent('plcf-theme', { detail: t }));
  };
  window.PLCF_THEME = {
    get, apply,
    current: () => document.documentElement.dataset.theme,
    cycle() { const order = ['auto', 'light', 'dark'], n = order[(order.indexOf(get()) + 1) % 3]; try { localStorage.setItem('plcf.theme', n); } catch (e) {} apply(); return n; },
  };
  mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
  apply();
})();
