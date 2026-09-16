# an-analytics-react-native — React Native SDK for Marki Analytics

Screens, taps, custom events, user identity and sessions for React Native (incl. Expo), landing in the
Marki Analytics dashboard. No native code. Optional: `@react-native-async-storage/async-storage` to persist
the visitor id between launches.

## Install

```sh
npm i github:Saidikrom/an-analytics-react-native#v1.0.0
# or
yarn add an-analytics-react-native@github:Saidikrom/an-analytics-react-native#v1.0.0
```

## Setup

```tsx
import { An, AnRoot } from 'an-analytics-react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';

const navRef = createNavigationContainerRef();
An.init({ host: 'https://analytics.marki.uz', key: 'pk_...', appName: 'myapp', appVersion: '1.2.0' });

export default function App() {
  return (
    <NavigationContainer ref={navRef}
      onReady={() => An.onNavigationReady(navRef)}
      onStateChange={() => An.onNavigationStateChange(navRef)}>
      <AnRoot>
        <RootStack />
      </AnRoot>
    </NavigationContainer>
  );
}
```

```tsx
An.identify(user.id, { phone: user.phone });          // after login
An.track('order_created', { amount: 120000 });
An.reset();                                           // logout
<Pressable onPress={An.press('buy', handleBuy)} />   // labelled tap
An.screen('custom/screen');                           // other routers
```

## What is automatic

- **Screens** — React Navigation route names (`OrderDetail` → `/order-detail`), time on screen.
- **Taps** — `AnRoot` captures every tap (not drags) with position for heatmaps; RN does not expose the pressed
  element's text, so wrap important handlers with `An.press('label', fn)` to name them.
- **Sessions** — 30 min of inactivity; AppState background flushes the queue.
- **App block** — platform, OS version, phone/tablet; pass `appVersion` from your build config.

Not yet: scroll depth, session replay.

## Releases

Tags on this repository. Change the `#vX.Y.Z` suffix and reinstall.
