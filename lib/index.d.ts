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
import React from 'react';
import { View } from 'react-native';
type Dict = Record<string, unknown>;
type NavLike = {
    getCurrentRoute?: () => {
        name?: string;
    } | undefined;
};
type NavRef = {
    current?: NavLike | null;
} | NavLike;
declare class AnClient {
    private host;
    private key;
    private appName;
    private appVersion;
    private debug;
    private cfg;
    private ready;
    private vid;
    private sid;
    private sidTouched;
    private userId;
    private traits;
    private queue;
    private flushTimer;
    private screenName;
    private screenEnteredAt;
    private prevScreen;
    private lastLabel;
    private log;
    init(o: {
        host: string;
        key: string;
        appName?: string;
        appVersion?: string;
        debug?: boolean;
    }): Promise<void>;
    identify(id: unknown, traits?: Dict): Promise<void>;
    reset(): Promise<void>;
    track(name: string, props?: Dict): void;
    screen(name: string): void;
    /** Wrap an onPress to label the next tap: `onPress={An.press('buy', doBuy)}` */
    press<T extends (...a: never[]) => unknown>(label: string, fn?: T): T;
    /** React Navigation glue */
    onNavigationReady(ref: NavRef): void;
    onNavigationStateChange(ref: NavRef): void;
    _tap(pageX: number, pageY: number, label: string | null): void;
    _takeLabel(): string | null;
    private enterScreen;
    private leaveScreen;
    private tracked;
    private session;
    private base;
    private push;
    private scheduleFlush;
    private envelope;
    flush(): Promise<void>;
    private loadConfig;
}
export declare const An: AnClient;
/** Root wrapper that captures taps (position + label set via `An.press`). Put it around the whole app. */
export declare function AnRoot({ children }: {
    children: React.ReactNode;
}): React.CElement<import("react-native").ViewProps, View>;
export {};
