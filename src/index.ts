/**
 * Marki Analytics — React Native SDK (TypeScript, no native code).
 *
 *   import { An, AnRoot } from './an-analytics';
 *   await An.init({ host: 'https://analytics.marki.uz', key: 'pk_...', appName: 'myapp', appVersion: '1.2.0' });
 *
 *   // React Navigation: screen views
 *   <NavigationContainer ref={navRef} onReady={() => An.onNavigationReady(navRef)} onStateChange={() => An.onNavigationStateChange(navRef)}>
 *     <AnRoot>{...}</AnRoot>            // taps (position + optional label via anPress)
 *   </NavigationContainer>
 *
 *   An.identify(user.id, { role: 'agent' });  An.track('order_created', { amount: 120000 });  An.reset();
 *   <Pressable onPress={An.press('buy', () => buy())}>   // labelled tap
 *
 * Storage: uses @react-native-async-storage/async-storage when installed (persisted visitor id),
 * otherwise falls back to memory for the app run.
 */
import React, { useCallback, useRef } from 'react';
import { AppState, AppStateStatus, Dimensions, GestureResponderEvent, NativeModules, Platform, View } from 'react-native';

type Dict = Record<string, unknown>;
type NavLike = { getCurrentRoute?: () => { name?: string } | undefined };
type NavRef = { current?: NavLike | null } | NavLike;
type Cfg = { pid: number; include: string[]; exclude: string[]; clicks: boolean; scroll: boolean };

const SESSION_TTL = 30 * 60 * 1000;
const FLUSH_MS = 3000;
const MAX_BATCH = 200;

// optional AsyncStorage
let storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  storage = require('@react-native-async-storage/async-storage').default;
} catch { storage = null; }
const mem: Record<string, string> = {};
const store = {
  get: async (k: string) => (storage ? storage.getItem(k) : mem[k] ?? null),
  set: async (k: string, v: string) => { mem[k] = v; if (storage) await storage.setItem(k, v); },
  del: async (k: string) => { delete mem[k]; if (storage) await storage.removeItem(k); },
};

const newId = () => Array.from({ length: 24 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const globToRe = (g: string) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

class AnClient {
  private host = ''; private key = ''; private appName = 'app'; private appVersion = ''; private debug = false;
  private cfg: Cfg | null = null; private ready = false;
  private vid = ''; private sid = ''; private sidTouched = 0; private userId: string | null = null; private traits: Dict | null = null;
  private queue: Dict[] = []; private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private screenName = '/'; private screenEnteredAt = 0; private prevScreen: string | null = null;
  private lastLabel: string | null = null;

  private log(...a: unknown[]) { if (this.debug) console.log('[an]', ...a); }

  async init(o: { host: string; key: string; appName?: string; appVersion?: string; debug?: boolean }) {
    this.host = o.host.replace(/\/$/, ''); this.key = o.key; this.appName = o.appName || 'app';
    this.appVersion = o.appVersion || ''; this.debug = !!o.debug;
    this.vid = (await store.get('_an_vid')) || newId(); await store.set('_an_vid', this.vid);
    this.userId = await store.get('_an_uid');
    const tr = await store.get('_an_tr'); if (tr) { try { this.traits = JSON.parse(tr); } catch { /* ignore */ } }
    await this.session();
    AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'background' || s === 'inactive') { this.leaveScreen(); this.screenEnteredAt = 0; this.flush(); }
      else if (s === 'active') { this.session(); if (!this.screenEnteredAt) this.enterScreen(this.screenName); }
    });
    this.cfg = await this.loadConfig(); this.ready = !!this.cfg;
    this.log(this.ready ? `ready (project ${this.cfg!.pid})` : 'config unavailable — tracking disabled');
    if (this.ready && this.queue.length) this.scheduleFlush(300);
  }

  // ---- public
  async identify(id: unknown, traits?: Dict) {
    const s = id == null ? '' : String(id);
    if (!s) return this.reset();
    this.userId = s.slice(0, 120); if (traits) this.traits = traits;
    await store.set('_an_uid', this.userId); if (this.traits) await store.set('_an_tr', JSON.stringify(this.traits));
    this.push({ t: 'identify', uid: this.userId, props: this.traits || undefined });
  }
  async reset() { this.userId = null; this.traits = null; await store.del('_an_uid'); await store.del('_an_tr'); await store.del('_an_sid'); this.sid = ''; await this.session(); }
  track(name: string, props?: Dict) { if (name) this.push({ t: 'custom', name: name.slice(0, 120), props }); }
  screen(name: string) { this.enterScreen(name.startsWith('/') ? name : `/${name}`); }
  /** Wrap an onPress to label the next tap: `onPress={An.press('buy', doBuy)}` */
  press<T extends (...a: never[]) => unknown>(label: string, fn?: T) { return ((...args: Parameters<T>) => { this.lastLabel = label; return fn?.(...args); }) as T; }

  /** React Navigation glue */
  onNavigationReady(ref: NavRef) { this.onNavigationStateChange(ref); }
  onNavigationStateChange(ref: NavRef) {
    const nav: NavLike | null | undefined = 'current' in (ref as object) ? (ref as { current?: NavLike | null }).current : (ref as NavLike);
    const name = nav?.getCurrentRoute?.()?.name;
    if (name) this.screen(name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
  }

  // ---- internals used by AnRoot
  _tap(pageX: number, pageY: number, label: string | null) {
    if (this.cfg && this.cfg.clicks === false) return;
    const { width } = Dimensions.get('window');
    this.push({ t: 'click', sel: `${this.screenName} > ${label ? 'press' : 'tap'}`, txt: label || '', xr: 0.5, yr: 0.5,
      pxn: width ? Math.min(1, Math.max(0, pageX / width)) : 0, py: Math.round(pageY), tag: label ? 'button' : 'view' });
  }
  _takeLabel() { const l = this.lastLabel; this.lastLabel = null; return l; }

  // ---- screens
  private enterScreen(name: string) {
    if (!this.tracked(name)) { this.log('screen excluded', name); return; }
    if (this.screenEnteredAt && this.screenName !== name) this.leaveScreen();
    this.prevScreen = this.screenName === name ? this.prevScreen : this.screenName;
    this.screenName = name; this.screenEnteredAt = Date.now();
    this.push({ t: 'pageview', ref: this.prevScreen ? `app://${this.appName}${this.prevScreen}` : null });
  }
  private leaveScreen() { if (this.screenEnteredAt) this.push({ t: 'leave', dur: Date.now() - this.screenEnteredAt }); }

  private tracked(path: string) {
    const c = this.cfg; if (!c) return true;
    if ((c.exclude || []).some((g) => g && globToRe(g).test(path))) return false;
    if ((c.include || []).length && !(c.include || []).some((g) => g && globToRe(g).test(path))) return false;
    return true;
  }

  private async session() {
    const now = Date.now();
    if (!this.sid) {
      const raw = await store.get('_an_sid');
      if (raw) { const [id, t] = raw.split(':'); if (id && now - Number(t) < SESSION_TTL) this.sid = id; }
      if (!this.sid) this.sid = newId();
    } else if (now - this.sidTouched > SESSION_TTL) this.sid = newId();
    this.sidTouched = now; await store.set('_an_sid', `${this.sid}:${now}`);
    return this.sid;
  }

  private base(): Dict {
    const { width, height } = Dimensions.get('window');
    return { ts: Date.now(), url: `app://${this.appName}${this.screenName}`, path: this.screenName, title: this.screenName, vw: Math.round(width), vh: Math.round(height) };
  }
  private push(ev: Dict) {
    this.queue.push({ ...this.base(), ...ev });
    if (!this.ready) return;
    this.scheduleFlush(ev.t === 'pageview' || ev.t === 'identify' || this.queue.length >= 20 ? 300 : FLUSH_MS);
  }
  private scheduleFlush(ms: number) { if (this.flushTimer) return; this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, ms); }

  private envelope(events: Dict[]): Dict {
    const { width, height } = Dimensions.get('window');
    const locale = (NativeModules as { SettingsManager?: { settings?: { AppleLocale?: string; AppleLanguages?: string[] } }; I18nManager?: { localeIdentifier?: string } });
    const lang = Platform.OS === 'ios' ? (locale.SettingsManager?.settings?.AppleLocale || locale.SettingsManager?.settings?.AppleLanguages?.[0] || '') : (locale.I18nManager?.localeIdentifier || '');
    return { k: this.key, v: this.vid, s: this.sid, u: this.userId, tr: this.traits, e: events, sc: [Math.round(width), Math.round(height)], lang, ref: null,
      app: { name: this.appName, version: this.appVersion, platform: Platform.OS, os_version: String(Platform.Version), device: Math.min(width, height) >= 600 ? 'tablet' : 'mobile' } };
  }

  async flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.ready || !this.queue.length) return;
    await this.session();
    const batch = this.queue.splice(0, MAX_BATCH);
    try {
      const res = await fetch(`${this.host}/i/e`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(this.envelope(batch)) });
      this.log(`sent ${batch.length} events -> ${res.status}`);
      if (!res.ok) this.queue.unshift(...batch);
    } catch (e) { this.log('send failed', e); this.queue.unshift(...batch); }
    if (this.queue.length) this.scheduleFlush(FLUSH_MS);
  }

  private async loadConfig(): Promise<Cfg | null> {
    try { const r = await fetch(`${this.host}/i/config?k=${encodeURIComponent(this.key)}`); return r.ok ? ((await r.json()) as Cfg) : null; }
    catch (e) { this.log('config failed', e); return null; }
  }
}

export const An = new AnClient();

/** Root wrapper that captures taps (position + label set via `An.press`). Put it around the whole app. */
export function AnRoot({ children }: { children: React.ReactNode }) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const onStart = useCallback((e: GestureResponderEvent) => { down.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; return false; }, []);
  const onEnd = useCallback((e: GestureResponderEvent) => {
    const d = down.current; down.current = null;
    if (!d || Math.hypot(e.nativeEvent.pageX - d.x, e.nativeEvent.pageY - d.y) > 18) return;
    // give onPress handlers (which set the label) a tick to run first
    setTimeout(() => An._tap(e.nativeEvent.pageX, e.nativeEvent.pageY, An._takeLabel()), 0);
  }, []);
  return React.createElement(View, { style: { flex: 1 }, onStartShouldSetResponderCapture: onStart, onTouchEnd: onEnd, collapsable: false }, children);
}
