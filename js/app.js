/* ===================== PrimeSphere — shared site logic ===================== */
/* Loaded on every page. Provides the "database" layer (persistent storage),
   header/menu wiring, toasts, generic modal helpers, and profile/session
   handling (including simulated Google / Facebook sign-in). */

const PrimeSphere = (function(){
  "use strict";

  /* ---------------- storage / "database" layer ---------------- */
  async function dbGet(key, shared){
    try{ const r = await window.storage.get(key, shared); return r ? JSON.parse(r.value) : null; }
    catch(e){ return null; }
  }
  async function dbSet(key, value, shared){
    try{ return await window.storage.set(key, JSON.stringify(value), shared); }
    catch(e){ console.error('storage set failed', key, e); return null; }
  }
  async function dbList(prefix, shared){
    try{ const r = await window.storage.list(prefix, shared); return r ? r.keys : []; }
    catch(e){ return []; }
  }
  async function dbDelete(key, shared){
    try{ return await window.storage.delete(key, shared); } catch(e){ return null; }
  }

  const SEED_JOBS = [
    {id:'seed_1', title:'Senior Product Designer', company:'North Atlas', dept:'Design', type:'Full-time', loc:'Austin, TX', level:'Senior', payDisplay:'$110k–$140k', paySort:110, posted:5, badge:'Featured', createdAt:Date.now()-5*864e5},
    {id:'seed_2', title:'Registered Nurse, ICU', company:'Harbor Bank Health', dept:'Medical', type:'Full-time', loc:'Denver, CO', level:'Mid', payDisplay:'$38–$46/hr', paySort:79, posted:1, badge:'New', createdAt:Date.now()-1*864e5},
    {id:'seed_3', title:'Journeyman Electrician', company:'Kiln & Co.', dept:'Trades', type:'Contract', loc:'Portland, OR', level:'Mid', payDisplay:'$34–$41/hr', paySort:71, posted:1, badge:'New', createdAt:Date.now()-1*864e5},
    {id:'seed_4', title:'Backend Engineer, Payments', company:'Vessel', dept:'Engineering', type:'Full-time', loc:'Remote (US)', level:'Senior', payDisplay:'$130k–$165k', paySort:130, posted:3, badge:'Remote', createdAt:Date.now()-3*864e5},
    {id:'seed_5', title:'Restaurant General Manager', company:'Greenfield', dept:'Hospitality', type:'Full-time', loc:'Chicago, IL', level:'Senior', payDisplay:'$62k–$74k', paySort:62, posted:4, badge:'Featured', createdAt:Date.now()-4*864e5},
    {id:'seed_6', title:'Studio Photographer', company:'Arc Studio', dept:'Creative', type:'Part-time', loc:'Brooklyn, NY', level:'Entry', payDisplay:'$28–$35/hr', paySort:58, posted:2, badge:'New', createdAt:Date.now()-2*864e5},
    {id:'seed_7', title:'Product Marketing Lead', company:'Vessel', dept:'Marketing', type:'Full-time', loc:'Austin, TX', level:'Mid', payDisplay:'$95k–$120k', paySort:95, posted:1, badge:'New', createdAt:Date.now()-1*864e5},
    {id:'seed_8', title:'Sales Development Rep', company:'Harbor Bank', dept:'Sales', type:'Full-time', loc:'Denver, CO', level:'Entry', payDisplay:'$55k–$70k', paySort:55, posted:2, badge:'New', createdAt:Date.now()-2*864e5},
    {id:'seed_9', title:'UX Researcher', company:'North Atlas', dept:'Design', type:'Contract', loc:'Remote (US)', level:'Mid', payDisplay:'$90k–$110k', paySort:90, posted:6, badge:'Featured', createdAt:Date.now()-6*864e5}
  ];

  async function loadJobs(){
    let keys = await dbList('jobs:', true);
    if(!keys || keys.length === 0){
      for(const j of SEED_JOBS){ await dbSet('jobs:'+j.id, j, true); }
      return SEED_JOBS.slice();
    }
    const loaded = [];
    for(const k of keys){ const j = await dbGet(k, true); if(j) loaded.push(j); }
    return loaded.length ? loaded : SEED_JOBS.slice();
  }

  /* ---------------- profile / "account" ---------------- */
  async function getProfile(){ return await dbGet('profile', false); }
  async function setProfile(p){ await dbSet('profile', p, false); updateHeaderProfile(p); return p; }
  async function clearProfile(){ await dbDelete('profile', false); updateHeaderProfile(null); }

  function updateHeaderProfile(profile){
    document.querySelectorAll('[data-login-link]').forEach(link => {
      if(profile && profile.name){
        link.textContent = 'Hi, ' + profile.name.split(' ')[0];
        link.setAttribute('href', 'account.html');
      } else {
        link.textContent = 'Log in';
        link.setAttribute('href', 'login.html');
      }
    });
  }

  /* ---------------- toast ---------------- */
  let toastTimer;
  function showToast(msg){
    let t = document.getElementById('ldgToast');
    if(!t){
      t = document.createElement('div');
      t.id = 'ldgToast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ---------------- generic modal helpers ---------------- */
  function openModal(id){ const el = document.getElementById(id); if(el) el.classList.add('open'); }
  function closeModal(id){ const el = document.getElementById(id); if(el) el.classList.remove('open'); }
  function wireGenericModals(){
    document.querySelectorAll('.modal-close[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
    });
    document.querySelectorAll('.modal-overlay').forEach(ov => {
      ov.addEventListener('click', (e) => { if(e.target === ov) ov.classList.remove('open'); });
    });
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(o => o.classList.remove('open'));
    });
  }

  /* ---------------- header / nav wiring (every page) ---------------- */
  function wireHeader(){
    const menuToggle = document.getElementById('menuToggle');
    const navLinks = document.getElementById('navLinks');
    if(menuToggle && navLinks){
      menuToggle.addEventListener('click', () => {
        const open = navLinks.classList.toggle('open');
        menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    // highlight current page in nav
    const here = (location.pathname.split('/').pop() || 'index.html');
    document.querySelectorAll('#navLinks a[href]').forEach(a => {
      if(a.getAttribute('href') === here) a.classList.add('nav-current');
    });
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function init(){
    wireHeader();
    wireGenericModals();
    const profile = await getProfile();
    updateHeaderProfile(profile);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { dbGet, dbSet, dbList, dbDelete, loadJobs, SEED_JOBS, getProfile, setProfile, clearProfile,
           updateHeaderProfile, showToast, openModal, closeModal, escapeHtml };
})();
