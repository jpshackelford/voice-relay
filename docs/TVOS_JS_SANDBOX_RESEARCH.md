# tvOS JavaScript Sandbox Research

*Research findings for Issue #139: Safely render AI-generated JavaScript apps on kiosk*

## Executive Summary

This document addresses how to enable an AI agent to dynamically create interactive visualizations and simple applications (like a Lemonade Stand game) that render consistently on both **web browsers** and **tvOS (Apple TV)**.

**Recommended Approach**: **React Native tvOS** for the tvOS app, sharing a common component schema with the existing React-based web kiosk.

---

## 1. The Cross-Platform Challenge

### 1.1 Key Constraint: No WebView on tvOS

**Apple does not support WKWebView on tvOS.** This was a deliberate decision to push developers toward native experiences. This means we cannot simply embed the web kiosk in a WebView on Apple TV.

Sources:
- [Apple TV doesn't support Webviews](https://www.developer-tech.com/news/apple-tv-doesnt-support-webviews-pushes-clean-native-experience/)
- [Apple TV: A World Without Webviews](https://medium.com/bpxl-craft/apple-tv-a-world-without-webkit-5c428a64a6dd)

### 1.2 Available Options

| Runtime | Description | Web Support | tvOS Support |
|---------|-------------|-------------|--------------|
| **TVMLKit + TVJS** | Apple's client-server model | ❌ No | ⚠️ Deprecated |
| **React Native tvOS** | Community fork with focus engine | ✅ Via react-native-web | ✅ Active |
| **Native SwiftUI** | Apple's modern UI framework | ❌ No | ✅ Native |
| **Separate codebases** | React (web) + SwiftUI (tvOS) | ✅ | ✅ |

---

## 2. Recommendation: React Native tvOS

### 2.1 Why React Native tvOS?

| Advantage | Description |
|-----------|-------------|
| **Same React paradigm** | Web kiosk already uses React; team knows the patterns |
| **Shared component schema** | Same JSON structure renders on both platforms |
| **Focus engine support** | Built-in handling for Siri Remote navigation |
| **Active maintenance** | Regular releases tracking React Native versions |
| **Android TV option** | Same codebase could target Android TV if needed |

### 2.2 Architecture

```
                    AI Agent (OpenHands)
                           │
                           │ Generates JSON component tree
                           ▼
                 ┌─────────────────────┐
                 │   Voice Relay Server │
                 │                      │
                 │  { type: "app",      │
                 │    components: [...] │
                 │  }                   │
                 └──────────┬──────────┘
                            │
              WebSocket display message
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
   ┌─────────────────┐            ┌─────────────────┐
   │   Web Kiosk     │            │   tvOS App      │
   │                 │            │                 │
   │  React          │            │  React Native   │
   │  (react-dom)    │            │  tvOS           │
   │                 │            │                 │
   │  <Card />       │            │  <Card />       │
   │  <StatusBar />  │            │  <StatusBar />  │
   │  <Chart />      │            │  <Chart />      │
   │                 │            │                 │
   └─────────────────┘            └─────────────────┘
           │                               │
           │      Same component schema    │
           │      Same visual output       │
           └───────────────────────────────┘
```

### 2.3 Code Sharing Strategy

**Option A: Shared component definitions (Recommended)**

Both platforms consume the same JSON schema. Components are implemented separately but follow the same interface:

```typescript
// Shared type definitions (used by both platforms)
interface CardComponent {
  type: 'card';
  id: string;
  title: string;
  content: string;
  icon?: string;
  highlight?: boolean;
}

// Web implementation (React)
const Card: React.FC<CardComponent> = ({ title, content, icon, highlight }) => (
  <div className={`card ${highlight ? 'highlight' : ''}`}>
    {icon && <span className="icon">{icon}</span>}
    <h3>{title}</h3>
    <p>{content}</p>
  </div>
);

// tvOS implementation (React Native)
const Card: React.FC<CardComponent> = ({ title, content, icon, highlight }) => (
  <View style={[styles.card, highlight && styles.highlight]}>
    {icon && <Text style={styles.icon}>{icon}</Text>}
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.content}>{content}</Text>
  </View>
);
```

**Option B: react-native-web for full code sharing**

Use `react-native-web` to run React Native components in the browser:

```
┌─────────────────────────────────────┐
│     Shared Component Library        │
│     (React Native components)       │
└──────────────────┬──────────────────┘
                   │
       ┌───────────┴───────────┐
       │                       │
       ▼                       ▼
┌─────────────┐         ┌─────────────┐
│ Web Kiosk   │         │ tvOS App    │
│ (RN Web)    │         │ (RN tvOS)   │
└─────────────┘         └─────────────┘
```

This maximizes code reuse but adds complexity to the web build.

---

## 3. Component Schema

### 3.1 Display Message Format

Extend the existing display protocol with an `app` type:

```typescript
type DisplayType = 'markdown' | 'image' | 'clear' | 'app';

interface AppDisplay {
  type: 'app';
  appType: string;        // 'lemonade-stand', 'quiz', 'chart'
  title?: string;
  state: {
    components: Component[];
    data: Record<string, any>;
  };
}
```

### 3.2 Component Types

```typescript
type Component =
  | CardComponent
  | GridComponent
  | ChartComponent
  | StatusBarComponent
  | CounterComponent
  | MessageComponent;

interface CardComponent {
  type: 'card';
  id: string;
  title: string;
  content: string;
  icon?: string;
  highlight?: boolean;
}

interface GridComponent {
  type: 'grid';
  id: string;
  columns: number;
  items: Array<{ id: string; label: string; icon?: string }>;
}

interface ChartComponent {
  type: 'chart';
  id: string;
  chartType: 'bar' | 'line' | 'pie';
  data: { labels: string[]; values: number[] };
  title?: string;
}

interface StatusBarComponent {
  type: 'status';
  id: string;
  items: Array<{ label: string; value: string | number; icon?: string }>;
}

interface CounterComponent {
  type: 'counter';
  id: string;
  label: string;
  value: number;
}

interface MessageComponent {
  type: 'message';
  id: string;
  text: string;
  variant: 'info' | 'success' | 'warning' | 'error';
}
```

### 3.3 Example: Lemonade Stand Game

**AI returns:**
```json
{
  "type": "display",
  "display": {
    "type": "app",
    "appType": "lemonade-stand",
    "title": "Lemonade Stand",
    "state": {
      "components": [
        {
          "type": "status",
          "id": "resources",
          "items": [
            { "label": "Money", "value": "$20.00", "icon": "💰" },
            { "label": "Lemons", "value": 30, "icon": "🍋" },
            { "label": "Sugar", "value": "2 cups", "icon": "🧂" }
          ]
        },
        {
          "type": "card",
          "id": "weather",
          "title": "Today's Weather",
          "content": "☀️ Sunny and Hot (92°F)",
          "highlight": true
        },
        {
          "type": "grid",
          "id": "actions",
          "columns": 2,
          "items": [
            { "id": "make", "label": "Make Lemonade", "icon": "🥤" },
            { "id": "price", "label": "Set Price", "icon": "💵" },
            { "id": "buy", "label": "Buy Supplies", "icon": "🛒" },
            { "id": "sell", "label": "Open Stand", "icon": "🏪" }
          ]
        }
      ],
      "data": {
        "day": 1,
        "money": 20.00,
        "lemons": 30
      }
    }
  }
}
```

This renders identically on web and tvOS.

---

## 4. tvOS-Specific Considerations

### 4.1 Focus Engine

React Native tvOS includes built-in support for the tvOS focus engine:

```tsx
import { TouchableOpacity } from 'react-native';

// Focusable button that responds to Siri Remote
const ActionButton = ({ label, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={styles.button}
    tvParallaxProperties={{ enabled: true }}
  >
    <Text>{label}</Text>
  </TouchableOpacity>
);
```

### 4.2 Remote Navigation

The Siri Remote D-pad maps to focus movement. Grid items become focusable:

```tsx
const Grid = ({ items, columns }) => (
  <View style={[styles.grid, { flexDirection: 'row', flexWrap: 'wrap' }]}>
    {items.map(item => (
      <TouchableOpacity
        key={item.id}
        style={{ width: `${100/columns}%` }}
        hasTVPreferredFocus={item.id === items[0].id}
      >
        <Text>{item.icon} {item.label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);
```

### 4.3 No Direct Touch

Since tvOS has no touch screen, all interaction is via:
- **Siri Remote**: D-pad navigation, select button
- **Voice**: User speaks to the mobile device, AI responds with updated UI

The tvOS app is primarily a **display surface**, not an input device.

---

## 5. Security: Data, Not Code

### 5.1 Design Principle

**The AI generates component definitions (data), not executable code.**

```
❌ BAD: AI generates JavaScript to execute
   { "type": "script", "code": "document.body.innerHTML = '...'" }

✅ GOOD: AI generates component tree
   { "type": "app", "components": [...] }
```

### 5.2 Validation

Server validates component trees before sending to clients:

```typescript
const KNOWN_TYPES = ['card', 'grid', 'chart', 'status', 'counter', 'message'];

function validateAppDisplay(display: AppDisplay): boolean {
  return display.state.components.every(c => KNOWN_TYPES.includes(c.type));
}
```

### 5.3 No eval() or Dynamic Code

The component library renders from data only:
- No `eval()` or `new Function()`
- No `dangerouslySetInnerHTML` with AI content
- All text content is escaped/sanitized

---

## 6. Implementation Plan

### 6.1 Phase 1: Web Kiosk (MVP)

1. Add `app` display type to existing protocol
2. Build component library for web kiosk (React)
3. Test with AI-generated Lemonade Stand game
4. Components: Card, StatusBar, Grid, Message

### 6.2 Phase 2: tvOS App

1. Create React Native tvOS app shell
2. Implement same components for tvOS
3. Add WebSocket connection to voice-relay server
4. Test focus navigation with Siri Remote

### 6.3 Phase 3: Shared Code

1. Extract shared types/schemas to common package
2. Evaluate react-native-web for full code sharing
3. Add chart components (victory-native works on both)

---

## 7. Alternatives Considered

### 7.1 Separate SwiftUI App

**Pros**: Native performance, Apple-supported
**Cons**: Separate codebase, different component implementations, no code sharing

### 7.2 TVMLKit + TVJS

**Pros**: JavaScript-based, server-driven UI
**Cons**: Deprecated by Apple, limited component set, no web support

### 7.3 Web-only (No tvOS)

**Pros**: Simplest, no native app needed
**Cons**: No Apple TV support, requires browser on TV

---

## 8. References

- [React Native tvOS](https://github.com/react-native-tvos/react-native-tvos) - The maintained fork
- [React Native for TV](https://reactnative.dev/docs/building-for-tv) - Official docs
- [react-native-web](https://necolas.github.io/react-native-web/) - Run RN components in browser
- [tvOS Focus Engine](https://developer.apple.com/documentation/uikit/focus-based_navigation) - Apple docs
- [Victory Native](https://formidable.com/open-source/victory/docs/native/) - Cross-platform charts

---

*This document was generated by an AI agent (OpenHands) as part of Issue #139 research.*
