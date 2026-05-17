# tvOS JavaScript Sandbox Research

*Research findings for Issue #139: Safely render AI-generated JavaScript apps on kiosk*

## Executive Summary

This document addresses how to enable an AI agent to dynamically create interactive visualizations and simple applications (like a Lemonade Stand game) on tvOS, where **all user interaction is through voice commands** rather than direct UI manipulation.

**Recommended Approach**: SwiftUI + WKWebView hybrid, with a **declarative UI component library** that the AI can compose to build interfaces.

---

## 1. JavaScript Runtime Options for tvOS

| Runtime | Description | UI Rendering | Voice Integration | Future-Proof |
|---------|-------------|--------------|-------------------|--------------|
| **TVMLKit + TVJS** | Apple's original client-server model; JavaScript drives TVML templates | Limited to TVML templates | Via SiriKit/MPRemoteCommandCenter | ⚠️ Deprecated |
| **React Native tvOS** | Community fork with tvOS focus engine support | Full React component model | Native bridging required | ✅ Active |
| **WKWebView** | WebKit engine embedded in SwiftUI | Full HTML/CSS/Canvas/WebGL | Native SwiftUI handles voice | ✅ Supported |
| **JavaScriptCore** | Low-level JS engine; no built-in UI | Requires custom rendering bridge | Native integration required | ✅ Supported |

**Recommendation**: **SwiftUI + WKWebView** provides the best balance of graphics flexibility (Canvas, SVG, charts) and native voice integration.

---

## 2. Architecture for Voice-Driven AI Visualizations

### 2.1 Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         tvOS App (SwiftUI)                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    Voice Command Layer                          │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │ │
│  │  │   Siri      │  │   Speech    │  │  Siri Remote D-pad      │ │ │
│  │  │   Intents   │  │   Framework │  │  (select, menu, etc.)   │ │ │
│  │  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘ │ │
│  │         │                │                      │               │ │
│  │         └────────────────┴──────────────────────┘               │ │
│  │                          │                                      │ │
│  │                    Command Router                               │ │
│  │                          │                                      │ │
│  └──────────────────────────┼──────────────────────────────────────┘ │
│                             │                                        │
│  ┌──────────────────────────┴──────────────────────────────────────┐ │
│  │                    Rendering Layer                               │ │
│  │                                                                  │ │
│  │  ┌─────────────────────────────────────────────────────────────┐│ │
│  │  │                   WKWebView                                  ││ │
│  │  │                                                              ││ │
│  │  │  ┌─────────────────────────────────────────────────────────┐││ │
│  │  │  │              UI Component Library                        │││ │
│  │  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │││ │
│  │  │  │  │   Card   │ │  Chart   │ │   Grid   │ │  GameBoard  │ │││ │
│  │  │  │  └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │││ │
│  │  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │││ │
│  │  │  │  │  Status  │ │  Timer   │ │  Counter │ │  Animation  │ │││ │
│  │  │  │  └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │││ │
│  │  │  └─────────────────────────────────────────────────────────┘││ │
│  │  │                                                              ││ │
│  │  │  evaluateJavaScript("render(componentTree)")                 ││ │
│  │  └──────────────────────────────────────────────────────────────┘│ │
│  │                                                                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                         Voice Relay Server                            │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      AI Agent (OpenHands)                        │ │
│  │                                                                  │ │
│  │  Input: "Let's play Lemonade Stand"                              │ │
│  │  Output: Declarative UI Definition (JSON)                        │ │
│  │                                                                  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

1. **User speaks**: "Let's play Lemonade Stand together"
2. **Voice Relay captures**: Speech-to-text → sends to AI
3. **AI generates UI definition**: Returns a declarative JSON structure
4. **Server sends display command**: `{ type: "display", displayType: "app", content: {...} }`
5. **tvOS renders**: SwiftUI passes JSON to WKWebView
6. **User interacts via voice**: "I want to make 20 cups of lemonade"
7. **AI updates state**: Returns updated UI definition

---

## 3. Declarative UI Component Library

### 3.1 Design Philosophy

The AI should compose UIs from **predefined building blocks** rather than generating arbitrary JavaScript. This provides:

- **Safety**: No arbitrary code execution; only rendering from data
- **Consistency**: All apps follow the same visual language
- **Voice-first**: Components designed for verbal interaction

### 3.2 Proposed Component Schema

```typescript
// Display message type for interactive apps
interface AppDisplay {
  type: 'app';
  appType: string;  // e.g., 'lemonade-stand', 'quiz', 'chart'
  state: AppState;
  voiceHints: string[];  // Suggested voice commands
}

interface AppState {
  components: Component[];
  data: Record<string, any>;
}

type Component =
  | CardComponent
  | GridComponent
  | ChartComponent
  | StatusBarComponent
  | CounterComponent
  | TimerComponent
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
  items: GridItem[];
}

interface ChartComponent {
  type: 'chart';
  id: string;
  chartType: 'bar' | 'line' | 'pie';
  data: ChartData;
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
  min?: number;
  max?: number;
  step?: number;
}

interface MessageComponent {
  type: 'message';
  id: string;
  text: string;
  variant: 'info' | 'success' | 'warning' | 'error';
}
```

### 3.3 Example: Lemonade Stand Game

**User says**: "Let's play Lemonade Stand"

**AI returns**:
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
            { "label": "Sugar", "value": "2 cups", "icon": "🧂" },
            { "label": "Ice", "value": "20 cubes", "icon": "🧊" }
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
        },
        {
          "type": "message",
          "id": "hint",
          "text": "Say 'make lemonade', 'set price', 'buy supplies', or 'open stand'",
          "variant": "info"
        }
      ],
      "data": {
        "day": 1,
        "money": 20.00,
        "lemons": 30,
        "sugar": 2,
        "ice": 20,
        "weather": "sunny",
        "temperature": 92
      }
    },
    "voiceHints": [
      "make lemonade",
      "set price to 50 cents",
      "buy 10 lemons",
      "open the stand"
    ]
  }
}
```

**User says**: "Make 10 cups of lemonade"

**AI updates state and returns new UI**:
```json
{
  "type": "display",
  "display": {
    "type": "app",
    "appType": "lemonade-stand",
    "state": {
      "components": [
        {
          "type": "status",
          "id": "resources",
          "items": [
            { "label": "Money", "value": "$20.00", "icon": "💰" },
            { "label": "Lemons", "value": 20, "icon": "🍋" },
            { "label": "Lemonade", "value": "10 cups", "icon": "🥤", "highlight": true }
          ]
        },
        {
          "type": "message",
          "id": "result",
          "text": "You made 10 cups of lemonade! Used 10 lemons and 1 cup of sugar.",
          "variant": "success"
        }
      ]
    }
  }
}
```

---

## 4. Voice Interaction Patterns

### 4.1 Command Types

| Category | Examples | Implementation |
|----------|----------|----------------|
| **Navigation** | "go back", "show menu", "next" | SwiftUI focus engine |
| **Selection** | "select the first option", "choose price" | Map to component IDs |
| **Value Input** | "set to 50 cents", "make 10 cups" | Parse numbers from speech |
| **Confirmation** | "yes", "no", "confirm", "cancel" | Simple intent matching |
| **Help** | "what can I say?", "help" | Display voiceHints |

### 4.2 Natural Language Processing

The AI handles NLP, not the tvOS app:

```
User: "I want to charge a dollar for each cup"
  ↓
Voice Relay transcribes to text
  ↓
AI interprets: Set price to $1.00
  ↓
AI updates game state and returns new UI
```

### 4.3 Voice Hints

The `voiceHints` array in each UI state provides contextual suggestions:

```swift
// SwiftUI displays hints as an overlay or accessibility label
Text("Try saying: \(voiceHints.joined(separator: ", "))")
    .font(.caption)
    .foregroundColor(.secondary)
```

---

## 5. Implementation Options

### 5.1 Option A: WKWebView Component Library (Recommended)

**tvOS Side**:
- SwiftUI app with embedded WKWebView
- HTML/CSS/JS component library bundled with app
- Voice commands captured via SiriKit/Speech framework
- Communication via `WKScriptMessageHandler` and `evaluateJavaScript`

**Server Side**:
- AI generates JSON component trees
- Server sends via existing display WebSocket message
- New display type: `app`

**Pros**:
- Rich graphics capability (charts, animations, canvas)
- Component library can evolve without app update
- Full CSS styling control

**Cons**:
- WKWebView focus handling requires custom implementation
- Slight overhead for web rendering

### 5.2 Option B: Native SwiftUI Components

**tvOS Side**:
- Pure SwiftUI with dynamic component rendering
- JSON-to-SwiftUI View mapper
- Native focus engine support

**Server Side**:
- Same JSON schema as Option A

**Pros**:
- Native performance and focus handling
- No WebView complexity

**Cons**:
- Adding new components requires app update
- Less flexible for rich visualizations
- SwiftUI charts/graphics more limited than web

### 5.3 Option C: React Native tvOS

**tvOS Side**:
- React Native app with component library
- JavaScript bundle updated via CodePush or app updates

**Server Side**:
- AI generates React component tree (JSON)

**Pros**:
- Cross-platform (could also target web kiosk)
- Rich React ecosystem

**Cons**:
- React Native tvOS is community-maintained
- Bridge overhead for complex UIs
- WebView not well supported in React Native tvOS

### 5.4 Comparison Matrix

| Factor | WKWebView | Native SwiftUI | React Native |
|--------|-----------|----------------|--------------|
| Graphics Capability | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Voice Integration | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Focus Engine | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Update Flexibility | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| Maintenance Burden | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Future-Proof | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 6. Security Considerations

### 6.1 No Arbitrary Code Execution

**Critical Design Decision**: The AI generates **data**, not code.

```
❌ BAD: AI generates JavaScript to execute
   { "type": "script", "code": "document.body.innerHTML = '...'" }

✅ GOOD: AI generates component definitions
   { "type": "app", "components": [...] }
```

### 6.2 Component Library as Sandbox

The component library acts as a natural sandbox:

- Only predefined components can be rendered
- No `eval()` or dynamic code execution
- Data is validated before rendering
- CSS is scoped and sanitized

### 6.3 Validation Layer

```typescript
// Server-side validation before sending to tvOS
function validateAppDisplay(display: AppDisplay): boolean {
  // Check all components are known types
  for (const component of display.state.components) {
    if (!KNOWN_COMPONENT_TYPES.includes(component.type)) {
      return false;
    }
  }
  // Validate data types and ranges
  // ...
  return true;
}
```

---

## 7. Protocol Extension

### 7.1 New Display Type: `app`

Extend the existing display message protocol:

```typescript
// Existing types
type DisplayType = 'markdown' | 'image' | 'clear' | 'app';  // Add 'app'

// App display message
interface DisplayMessage {
  type: 'display';
  display: {
    type: 'app';
    appType: string;        // 'lemonade-stand', 'chart', 'quiz', etc.
    title?: string;
    state: AppState;
    voiceHints?: string[];
  };
}
```

### 7.2 App State Updates

For efficient updates, support partial state changes:

```typescript
interface AppStateUpdate {
  type: 'display-update';
  target: string;           // Component ID
  changes: Partial<Component>;
}
```

---

## 8. Example Use Cases

### 8.1 Lemonade Stand (Educational Game)
- Voice-driven buying, making, pricing, selling
- Weather affects demand
- Track profit/loss
- Components: StatusBar, Cards, Counters

### 8.2 Quiz/Trivia
- "What's your answer? A, B, C, or D?"
- Timer component
- Score tracking
- Components: Question Card, Timer, Score Counter

### 8.3 Data Visualization
- "Show me sales by region"
- Chart components (bar, line, pie)
- Components: Charts, Legends, Filters

### 8.4 Flashcards
- "Flip the card", "Next card"
- Spaced repetition tracking
- Components: Card (flippable), Progress

---

## 9. Recommendations

### 9.1 Short-term (MVP)

1. **Add `app` display type** to existing protocol
2. **Build minimal component set**: Card, Status, Message, Grid
3. **Test with web kiosk** before tvOS implementation
4. **AI prompt engineering** to generate valid component trees

### 9.2 Medium-term

1. **WKWebView component library** for tvOS
2. **Chart components** using Canvas/SVG
3. **Voice hint UI** with suggested commands
4. **State persistence** for multi-turn interactions

### 9.3 Long-term

1. **Custom app templates** (pre-built games/visualizations)
2. **Animation components** for engaging feedback
3. **Accessibility features** (VoiceOver integration)
4. **Component marketplace** for user-contributed components

---

## 10. References

- [React Native tvOS](https://github.com/react-native-tvos/react-native-tvos)
- [TVMLKit Documentation](https://developer.apple.com/documentation/tvmljs) (Deprecated)
- [SwiftUI Focus Engine](https://developer.apple.com/documentation/swiftui/focus)
- [WKWebView in SwiftUI](https://codewithchris.com/swiftui-webview/)
- [SiriKit Media Intents](https://developer.apple.com/videos/play/wwdc2020/10061/)
- [Speech Framework](https://developer.apple.com/documentation/speech)
- [tvOS Focus Best Practices](https://www.oxagile.com/article/tvos-focus-engine-best-practices/)

---

*This document was generated by an AI agent (OpenHands) as part of Issue #139 research.*
