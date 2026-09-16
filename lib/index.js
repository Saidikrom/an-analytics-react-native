"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.An = void 0;
exports.AnRoot = AnRoot;
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
const react_1 = __importStar(require("react"));
const react_native_1 = require("react-native");
const SESSION_TTL = 30 * 60 * 1000;
const FLUSH_MS = 3000;
const MAX_BATCH = 200;
// optional AsyncStorage
let storage = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    storage = require('@react-native-async-storage/async-storage').default;
}
catch {
    storage = null;
}
const mem = {};
const store = {
    get: async (k) => { var _a; return (storage ? storage.getItem(k) : (_a = mem[k]) !== null && _a !== void 0 ? _a : null); },
    set: async (k, v) => { mem[k] = v; if (storage)
        await storage.setItem(k, v); },
    del: async (k) => { delete mem[k]; if (storage)
        await storage.removeItem(k); },
};
const newId = () => Array.from({ length: 24 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
class AnClient {
    constructor() {
        this.host = '';
        this.key = '';
        this.appName = 'app';
        this.appVersion = '';
        this.debug = false;
        this.cfg = null;
        this.ready = false;
        this.vid = '';
        this.sid = '';
        this.sidTouched = 0;
        this.userId = null;
        this.traits = null;
        this.queue = [];
        this.flushTimer = null;
        this.screenName = '/';
        this.screenEnteredAt = 0;
        this.prevScreen = null;
        this.lastLabel = null;
    }
    log(...a) { if (this.debug)
        console.log('[an]', ...a); }
    async init(o) {
        this.host = o.host.replace(/\/$/, '');
        this.key = o.key;
        this.appName = o.appName || 'app';
        this.appVersion = o.appVersion || '';
        this.debug = !!o.debug;
        this.vid = (await store.get('_an_vid')) || newId();
        await store.set('_an_vid', this.vid);
        this.userId = await store.get('_an_uid');
        const tr = await store.get('_an_tr');
        if (tr) {
            try {
                this.traits = JSON.parse(tr);
            }
            catch { /* ignore */ }
        }
        await this.session();
        react_native_1.AppState.addEventListener('change', (s) => {
            if (s === 'background' || s === 'inactive') {
                this.leaveScreen();
                this.screenEnteredAt = 0;
                this.flush();
            }
            else if (s === 'active') {
                this.session();
                if (!this.screenEnteredAt)
                    this.enterScreen(this.screenName);
            }
        });
        this.cfg = await this.loadConfig();
        this.ready = !!this.cfg;
        this.log(this.ready ? `ready (project ${this.cfg.pid})` : 'config unavailable — tracking disabled');
        if (this.ready && this.queue.length)
            this.scheduleFlush(300);
    }
    // ---- public
    async identify(id, traits) {
        const s = id == null ? '' : String(id);
        if (!s)
            return this.reset();
        this.userId = s.slice(0, 120);
        if (traits)
            this.traits = traits;
        await store.set('_an_uid', this.userId);
        if (this.traits)
            await store.set('_an_tr', JSON.stringify(this.traits));
        this.push({ t: 'identify', uid: this.userId, props: this.traits || undefined });
    }
    async reset() { this.userId = null; this.traits = null; await store.del('_an_uid'); await store.del('_an_tr'); await store.del('_an_sid'); this.sid = ''; await this.session(); }
    track(name, props) { if (name)
        this.push({ t: 'custom', name: name.slice(0, 120), props }); }
    screen(name) { this.enterScreen(name.startsWith('/') ? name : `/${name}`); }
    /** Wrap an onPress to label the next tap: `onPress={An.press('buy', doBuy)}` */
    press(label, fn) { return ((...args) => { this.lastLabel = label; return fn === null || fn === void 0 ? void 0 : fn(...args); }); }
    /** React Navigation glue */
    onNavigationReady(ref) { this.onNavigationStateChange(ref); }
    onNavigationStateChange(ref) {
        var _a, _b;
        const nav = 'current' in ref ? ref.current : ref;
        const name = (_b = (_a = nav === null || nav === void 0 ? void 0 : nav.getCurrentRoute) === null || _a === void 0 ? void 0 : _a.call(nav)) === null || _b === void 0 ? void 0 : _b.name;
        if (name)
            this.screen(name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
    }
    // ---- internals used by AnRoot
    _tap(pageX, pageY, label) {
        if (this.cfg && this.cfg.clicks === false)
            return;
        const { width } = react_native_1.Dimensions.get('window');
        this.push({ t: 'click', sel: `${this.screenName} > ${label ? 'press' : 'tap'}`, txt: label || '', xr: 0.5, yr: 0.5,
            pxn: width ? Math.min(1, Math.max(0, pageX / width)) : 0, py: Math.round(pageY), tag: label ? 'button' : 'view' });
    }
    _takeLabel() { const l = this.lastLabel; this.lastLabel = null; return l; }
    // ---- screens
    enterScreen(name) {
        if (!this.tracked(name)) {
            this.log('screen excluded', name);
            return;
        }
        if (this.screenEnteredAt && this.screenName !== name)
            this.leaveScreen();
        this.prevScreen = this.screenName === name ? this.prevScreen : this.screenName;
        this.screenName = name;
        this.screenEnteredAt = Date.now();
        this.push({ t: 'pageview', ref: this.prevScreen ? `app://${this.appName}${this.prevScreen}` : null });
    }
    leaveScreen() { if (this.screenEnteredAt)
        this.push({ t: 'leave', dur: Date.now() - this.screenEnteredAt }); }
    tracked(path) {
        const c = this.cfg;
        if (!c)
            return true;
        if ((c.exclude || []).some((g) => g && globToRe(g).test(path)))
            return false;
        if ((c.include || []).length && !(c.include || []).some((g) => g && globToRe(g).test(path)))
            return false;
        return true;
    }
    async session() {
        const now = Date.now();
        if (!this.sid) {
            const raw = await store.get('_an_sid');
            if (raw) {
                const [id, t] = raw.split(':');
                if (id && now - Number(t) < SESSION_TTL)
                    this.sid = id;
            }
            if (!this.sid)
                this.sid = newId();
        }
        else if (now - this.sidTouched > SESSION_TTL)
            this.sid = newId();
        this.sidTouched = now;
        await store.set('_an_sid', `${this.sid}:${now}`);
        return this.sid;
    }
    base() {
        const { width, height } = react_native_1.Dimensions.get('window');
        return { ts: Date.now(), url: `app://${this.appName}${this.screenName}`, path: this.screenName, title: this.screenName, vw: Math.round(width), vh: Math.round(height) };
    }
    push(ev) {
        this.queue.push({ ...this.base(), ...ev });
        if (!this.ready)
            return;
        this.scheduleFlush(ev.t === 'pageview' || ev.t === 'identify' || this.queue.length >= 20 ? 300 : FLUSH_MS);
    }
    scheduleFlush(ms) { if (this.flushTimer)
        return; this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, ms); }
    envelope(events) {
        var _a, _b, _c, _d, _e, _f;
        const { width, height } = react_native_1.Dimensions.get('window');
        const locale = react_native_1.NativeModules;
        const lang = react_native_1.Platform.OS === 'ios' ? (((_b = (_a = locale.SettingsManager) === null || _a === void 0 ? void 0 : _a.settings) === null || _b === void 0 ? void 0 : _b.AppleLocale) || ((_e = (_d = (_c = locale.SettingsManager) === null || _c === void 0 ? void 0 : _c.settings) === null || _d === void 0 ? void 0 : _d.AppleLanguages) === null || _e === void 0 ? void 0 : _e[0]) || '') : (((_f = locale.I18nManager) === null || _f === void 0 ? void 0 : _f.localeIdentifier) || '');
        return { k: this.key, v: this.vid, s: this.sid, u: this.userId, tr: this.traits, e: events, sc: [Math.round(width), Math.round(height)], lang, ref: null,
            app: { name: this.appName, version: this.appVersion, platform: react_native_1.Platform.OS, os_version: String(react_native_1.Platform.Version), device: Math.min(width, height) >= 600 ? 'tablet' : 'mobile' } };
    }
    async flush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (!this.ready || !this.queue.length)
            return;
        await this.session();
        const batch = this.queue.splice(0, MAX_BATCH);
        try {
            const res = await fetch(`${this.host}/i/e`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(this.envelope(batch)) });
            this.log(`sent ${batch.length} events -> ${res.status}`);
            if (!res.ok)
                this.queue.unshift(...batch);
        }
        catch (e) {
            this.log('send failed', e);
            this.queue.unshift(...batch);
        }
        if (this.queue.length)
            this.scheduleFlush(FLUSH_MS);
    }
    async loadConfig() {
        try {
            const r = await fetch(`${this.host}/i/config?k=${encodeURIComponent(this.key)}`);
            return r.ok ? (await r.json()) : null;
        }
        catch (e) {
            this.log('config failed', e);
            return null;
        }
    }
}
exports.An = new AnClient();
/** Root wrapper that captures taps (position + label set via `An.press`). Put it around the whole app. */
function AnRoot({ children }) {
    const down = (0, react_1.useRef)(null);
    const onStart = (0, react_1.useCallback)((e) => { down.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; return false; }, []);
    const onEnd = (0, react_1.useCallback)((e) => {
        const d = down.current;
        down.current = null;
        if (!d || Math.hypot(e.nativeEvent.pageX - d.x, e.nativeEvent.pageY - d.y) > 18)
            return;
        // give onPress handlers (which set the label) a tick to run first
        setTimeout(() => exports.An._tap(e.nativeEvent.pageX, e.nativeEvent.pageY, exports.An._takeLabel()), 0);
    }, []);
    return react_1.default.createElement(react_native_1.View, { style: { flex: 1 }, onStartShouldSetResponderCapture: onStart, onTouchEnd: onEnd, collapsable: false }, children);
}
